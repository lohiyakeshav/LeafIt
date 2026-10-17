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
SPECIES = json.loads((ROOT / "shared/species.json").read_text())   # street-tree catalogue, shared with the browser

# Data on disk (backend/data). Everything that reads or writes files gets its folder from here, never from __file__.
DATA_DIR = Path(os.environ.get("LEAFIT_DATA_DIR", Path(__file__).parents[1] / "data"))
BLOCKS_DIR = DATA_DIR / "blocks"     # shipped sample blocks (read-only)
AREAS_DIR = DATA_DIR / "areas"       # areas built from satellite data (cache)
PLANS_DIR = DATA_DIR / "plans"       # saved plans
FX_DIR = DATA_DIR / "fx"             # one exchange-rate snapshot per day
# Saved plans and built areas are a cache, not an archive: nothing in the app lists old ones, so they expire.
PLAN_TTL_DAYS = float(os.environ.get("LEAFIT_PLAN_TTL_DAYS", 7))     # long enough to finish review, quotes, proposal
AREA_TTL_DAYS = float(os.environ.get("LEAFIT_AREA_TTL_DAYS", 30))    # rebuilt from satellite data if asked for again
WEB_DIR = Path(os.environ.get("LEAFIT_WEB_DIR", ROOT / "frontend/dist"))

EE_PROJECT = os.environ.get("EE_PROJECT")  # Earth Engine cloud project; falls back to the service account's project
# Earth Engine service-account key (git-ignored). EE_KEY_FILE is read only here, unlike GOOGLE_APPLICATION_CREDENTIALS, which every
# Google library picks up: on Cloud Run a key mounted from another project must not also become Vertex AI's identity.
_key = os.environ.get("EE_KEY_FILE") or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or str(ROOT / "EarthCredentials.json")
EE_KEY_FILE = Path(_key)
GOOGLE_MAPS_SERVER_KEY = os.environ.get("GOOGLE_MAPS_SERVER_KEY")  # Places / Air Quality (server side)
# Browser Maps key, handed to the web app at runtime (/config.js), so an image built without it (e.g. Cloud Run's GitHub deploy) still
# shows maps. Public by nature: protect it with an HTTP-referrer restriction, not secrecy.
GOOGLE_MAPS_BROWSER_KEY = os.environ.get("GOOGLE_MAPS_BROWSER_KEY", "")
