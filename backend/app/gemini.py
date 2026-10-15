"""Gemini client + the numbers guardrail shared by every Gen AI feature.

Config (first match wins):
  GEMINI_API_KEY        -> Google AI Studio key (quickest for local dev)
  GOOGLE_CLOUD_PROJECT  -> Vertex AI with Application Default Credentials (Cloud Run uses its service account)
Neither set -> client() returns None and every feature falls back to its offline path.
"""
import json
import os
import re

from google import genai
from google.genai import types

MODEL = os.environ.get("LEAFIT_GEMINI_MODEL", "gemini-2.5-flash")
_client = None


def client():
    global _client
    if _client is None:
        opts = types.HttpOptions(timeout=30_000)
        if os.environ.get("GEMINI_API_KEY"):
            _client = genai.Client(api_key=os.environ["GEMINI_API_KEY"], http_options=opts)
        elif os.environ.get("GOOGLE_CLOUD_PROJECT"):  # location from GOOGLE_CLOUD_LOCATION
            _client = genai.Client(vertexai=True, http_options=opts)
    return _client


_NUM = re.compile(r"-?\d[\d,]*\.?\d*")


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
    and rounding, so '₹18.5 lakh' matches 1850000 and '0.57 °C' matches 0.571."""
    known = _numbers(json.dumps(sources, ensure_ascii=False))
    scaled = {round(k / s, 3) for k in known for s in (1, 1e3, 1e5, 1e7)}
    ok = lambda n: n < 20 and n == int(n) or any(abs(n - k) <= max(0.01, 0.006 * k) for k in scaled)  # small ints = counts/list items
    return sorted(n for n in _numbers(text) if not ok(n))
