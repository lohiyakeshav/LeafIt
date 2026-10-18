"""Gemini client + the numbers guardrail shared by every Gen AI feature.

Two backends, same models and same code:
  studio  GEMINI_API_KEY is set                     -> Google AI Studio (quickest for local dev; free keys are rate-limited to a few requests a minute)
  vertex  LEAFIT_VERTEX_CREDENTIALS or GOOGLE_CLOUD_PROJECT is set
                                                    -> Vertex AI, billed to the project, no free-tier limits.
          LEAFIT_VERTEX_CREDENTIALS = path to a service-account key (its project is used); without it Application Default
          Credentials are used, so on Cloud Run the attached service account just works. GOOGLE_CLOUD_LOCATION defaults to "global".
LEAFIT_GEMINI_BACKEND=studio|vertex picks one when both are configured; the default ("auto") prefers the API key.
(GOOGLE_APPLICATION_CREDENTIALS is deliberately not used here: it belongs to Earth Engine.)
Nothing configured -> client() returns None and every feature falls back to its offline path.
"""
import json
import os
import re
import threading
import time
from datetime import date
from pathlib import Path

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

MODEL = os.environ.get("LEAFIT_GEMINI_MODEL", "gemini-2.5-flash")
# The planner can use a different (e.g. stronger) model than the cheap writers: LEAFIT_PLANNER_MODEL=gemini-2.5-pro to compare quality.
PLANNER_MODEL = os.environ.get("LEAFIT_PLANNER_MODEL", MODEL)
# Reasoning tokens the planner may spend before answering: 0 switches thinking off, -1 lets the model decide.
PLANNER_THINKING = int(os.environ.get("LEAFIT_PLANNER_THINKING", "1024"))
_client = None


def _vertex_client(opts):
    path = os.environ.get("LEAFIT_VERTEX_CREDENTIALS")
    project, creds = os.environ.get("GOOGLE_CLOUD_PROJECT"), None
    if path:
        from google.oauth2 import service_account
        creds = service_account.Credentials.from_service_account_file(Path(__file__).parents[2] / path, scopes=["https://www.googleapis.com/auth/cloud-platform"])
        project = creds.project_id
    return genai.Client(vertexai=True, project=project, location=os.environ.get("GOOGLE_CLOUD_LOCATION", "global"), credentials=creds, http_options=opts)


def client():
    global _client
    if _client is None:
        opts = types.HttpOptions(timeout=90_000)   # a planner turn with thinking and two images can take a while
        backend = os.environ.get("LEAFIT_GEMINI_BACKEND", "auto")
        studio, vertex = bool(os.environ.get("GEMINI_API_KEY")), bool(os.environ.get("LEAFIT_VERTEX_CREDENTIALS") or os.environ.get("GOOGLE_CLOUD_PROJECT"))
        if studio and backend in ("auto", "studio"):
            _client = genai.Client(api_key=os.environ["GEMINI_API_KEY"], http_options=opts)
        elif vertex and backend in ("auto", "vertex"):
            _client = _vertex_client(opts)
    return _client


_NUM = re.compile(r"-?\d[\d,]*\.?\d*")


RATE_LIMIT_RETRIES = 3
RATE_LIMIT_MAX_WAIT_S = 65.0


def _retry_after(e: Exception) -> float:
    """Seconds the server asked us to wait ('retry in 58.4s' / '428.6ms'), or a short default."""
    m = re.search(r"retry in ([\d.]+)(ms|s)", str(e))
    return (float(m.group(1)) / (1000 if m.group(2) == "ms" else 1)) if m else 15.0


# Spending guard: at most this many Gemini calls a day (one AI plan is ~6-12 calls, a proposal 1). Past it, AI features say so
# until midnight UTC instead of spending more. 0 = no limit.
# ponytail: counted per server instance (Cloud Run max instances × this is the real ceiling); a shared counter needs Firestore.
DAILY_CALL_LIMIT = int(os.environ.get("LEAFIT_GEMINI_DAILY_CALLS", "600"))
_spend_lock, _spend_day, _spend_calls = threading.Lock(), None, 0


class DailyLimitReached(Exception):
    """Today's Gemini allowance is used up. Message is user-safe."""


def _count_call() -> None:
    global _spend_day, _spend_calls
    with _spend_lock:
        today = date.today()
        if today != _spend_day:
            _spend_day, _spend_calls = today, 0
        if DAILY_CALL_LIMIT and _spend_calls >= DAILY_CALL_LIMIT:
            raise DailyLimitReached("Today's AI allowance for this demo is used up. Please try again tomorrow.")
        _spend_calls += 1


def generate(llm, **kwargs):
    """llm.models.generate_content, riding out a per-minute rate limit (429) or a busy/failing model (500, 503, 504) instead of
    failing the whole plan.

    The server's own "retry in N s" is honoured (capped); a daily quota (it won't reset in time), a long wait or any other
    error is raised as before.
    """
    _count_call()
    for attempt in range(RATE_LIMIT_RETRIES + 1):
        try:
            return llm.models.generate_content(**kwargs)
        except (genai_errors.ClientError, genai_errors.ServerError) as e:
            daily = "PerDay" in str(e)
            wait = None if daily else _retry_after(e) + 1 if e.code == 429 else 3.0 if e.code in (500, 503, 504) else None
            if wait is None or attempt == RATE_LIMIT_RETRIES or wait > RATE_LIMIT_MAX_WAIT_S:
                raise
            time.sleep(wait)


def _numbers(text: str) -> set[float]:
    out = set()
    for m in _NUM.findall(text):
        try:
            out.add(round(abs(float(m.replace(",", ""))), 3))
        except ValueError:
            pass
    return out


def unverified_numbers(text: str, *sources) -> list[float]:
    """Numbers in `text` that appear in none of the tool outputs. Allows unit rescaling (₹ lakh/crore, kg↔t)
    rounding and shares as percent, so '₹18.5 lakh' matches 1850000, '0.57 °C' matches 0.571 and '73%' matches 0.733."""
    known = _numbers(json.dumps(sources, ensure_ascii=False))
    scaled = {round(k / s, 3) for k in known for s in (1, 1e3, 1e5, 1e7)}
    scaled |= {round(100 * k, 3) for k in known if 0 < k <= 1}   # a share the tools gave as 0.733 may be written '73.3%'
    ok = lambda n: n < 20 and n == int(n) or any(abs(n - k) <= max(0.01, 0.006 * k) for k in scaled)  # small ints = counts/list items
    return sorted(n for n in _numbers(text) if not ok(n))
