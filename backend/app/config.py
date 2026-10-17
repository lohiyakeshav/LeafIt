"""Settings and the shared model constants (one JSON file read by both the Python and JS simulators)."""
import json
import os
from pathlib import Path

ROOT = Path(__file__).parents[2]

# Local dev: read backend/.env (git-ignored) if present. Real environment variables win, so Cloud Run is unaffected.
_env = Path(__file__).parents[1] / ".env"
if _env.exists():
    for _line in _env.read_text().splitlines():
        _k, _sep, _v = _line.partition("=")
        if _sep and _k.strip() and not _k.lstrip().startswith("#") and _v.strip():
            os.environ.setdefault(_k.strip(), _v.strip().strip('"\''))
MODEL = json.loads(Path(os.environ.get("LEAFIT_MODEL_JSON", ROOT / "shared/model.json")).read_text())

BLOCKS_DIR = Path(__file__).parents[1] / "data/blocks"
AREAS_DIR = Path(__file__).parents[1] / "data/areas"
WEB_DIR = Path(os.environ.get("LEAFIT_WEB_DIR", ROOT / "frontend/dist"))

EE_PROJECT = os.environ.get("EE_PROJECT")  # Earth Engine cloud project; falls back to the service account's project
_key = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or str(ROOT / "EarthCredentials.json")  # git-ignored service-account key
EE_KEY_FILE = Path(_key)
# Dev only: if Earth Engine is unreachable, build a clearly-labelled SYNTHETIC area instead of failing.
ALLOW_SYNTHETIC_AREAS = os.environ.get("LEAFIT_ALLOW_SYNTHETIC_AREAS", "").lower() in ("1", "true", "yes")
GOOGLE_MAPS_SERVER_KEY = os.environ.get("GOOGLE_MAPS_SERVER_KEY")  # Places / Air Quality (server side)
