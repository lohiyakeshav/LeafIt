# LeafIt

**Redesign your block. Leave it greener.**
An AI-powered climate intervention simulator, built by Friendly Neighbourhood Devs.

Search for a real place, mark out your neighbourhood on the satellite map, and test trees, cool roofs and shaded bus stops on a 2.5D isometric twin of it. Cooling, heat exposure, CO₂, air quality and cost update as you place things. A Gemini planner can propose a plan within your budget, and local vendors turn it into a quote.

## How it works

1. **Find your place.** `/explore` is a Google satellite map that opens at your location. Search a place, then drag a box over the area (200 m up to about 1 km², no side over 1.5 km). The size is shown live and the box snaps back inside the limits.
2. **Build the area.** `POST /areas` fetches real data from Google Earth Engine: Landsat surface temperature, ESA WorldCover land cover, and Open Buildings footprints and heights. It also adds live weather, air quality and nearby landmarks. Built areas are cached.
3. **Work on it in 2.5D.** `/area/:id` is a three.js isometric diorama with the satellite photo as the ground. Place trees (or paint them by dragging), coat roofs, add shaded stops, erase, undo, and turn the view.
4. **Live numbers.** The cooling model runs in a Web Worker in your browser on every change. The server runs the same model for Review, saved plans and the agent.
5. **Review and build.** Review shows the measured heat against your plan on the satellite photo, with a bill of materials and a funding proposal; Vendors finds suppliers within 25 km and writes the quote request.
6. **Your prices, your currency.** Tree, cool-roof and bus-stop prices and the budget are editable; money can be shown in 14 currencies at today's rates (all maths stays in INR).

## Architecture

New to the code? Read **[ARCHITECTURE.md](ARCHITECTURE.md)**: how the pieces fit, the dependency rules, and a "where do I…" table. Package maps: [backend/README.md](backend/README.md), [frontend/README.md](frontend/README.md).

```
shared/      model.json (the model's numbers and rules, read by both simulators) + golden fixtures
backend/     FastAPI: api/ → services/ → domain/, agents/, integrations/, storage/
frontend/    React: app/, features/ (one per page), model/ (simulator), shared/ (ui, layout, metrics, lib), state/, api/
```

Performance choices: the three.js scene renders only when something changes (an idle GPU does nothing), uses about 9 draw calls (all buildings are one mesh, trees are GPU-billboarded instances), and loads only on the Studio route. The Maps SDK loads only on the Explore route. The simulator never blocks the UI thread.

## Setup

Requires Python 3.12, Node 22+ and Docker (only for the image).

### 1. Backend

```bash
cd backend
python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cp .env.example .env              # add keys (see Configuration)
.venv/bin/uvicorn app.main:app --reload --port 8000
```

### 2. Web app

```bash
cd frontend
cp .env.example .env.local        # then put your browser Maps key in it
npm install
npm run dev                       # http://localhost:5173 (API calls are proxied to :8000)
```

### 3. Tests and lint

```bash
cd backend  && .venv/bin/python -m pytest && .venv/bin/ruff check .   # 46 tests, offline; lint
cd frontend && npm test && npm run lint && npm run build               # simulator parity, geometry, money…; lint; build
cd backend  && .venv/bin/python scripts/ee_smoke.py                    # LIVE Earth Engine check (needs credentials)
```

After changing the model on purpose: edit `shared/model.json`, then `.venv/bin/python scripts/make_golden.py` (from `backend/`) and re-run both suites.

## Configuration

| Variable | Where | Purpose |
|---|---|---|
| `VITE_GOOGLE_MAPS_API_KEY` | `frontend/.env.local` | Browser key: Maps JavaScript, Places (New), Map Tiles |
| `GOOGLE_APPLICATION_CREDENTIALS` | backend env | Path to the Earth Engine service-account key. Defaults to `EarthCredentials.json` at the repo root |
| `EE_PROJECT` | backend env | Earth Engine cloud project (defaults to the key's project) |
| `GOOGLE_MAPS_SERVER_KEY` | backend env | Optional: Places landmarks and Air Quality. Without it landmarks are empty and AQI uses a default |
| `GEMINI_API_KEY` | backend env | Planner agent and funding proposals. Without it the planner uses simple rules and proposals use a template |
| `LEAFIT_ALLOW_SYNTHETIC_AREAS=1` | backend env | Dev only: if Earth Engine is unreachable, build a clearly labelled **synthetic stand-in** instead of an error |

Templates: `frontend/.env.example`, `backend/.env.example`. Real keys are never committed: `.env*` files and credential JSON files are excluded from git, Docker builds and `gcloud --source` uploads.


## Deploy (Cloud Run)

```bash
docker build --build-arg VITE_GOOGLE_MAPS_API_KEY=<browser key> -t leafit .
docker run -p 8080:8080 -e GEMINI_API_KEY=... -e EE_PROJECT=... leafit
```

One container serves the API and the built web app. On Cloud Run, do not ship a key file: attach a service account (with the two Earth Engine roles above) to the service. Built areas are cached on local disk, which Cloud Run loses on restart; move `backend/app/storage/store.py` to Firestore or GCS when that matters.

## Known limits

- Roofs are modelled per 10 m cell, so coating one building can include a neighbour's share of a shared cell.
- Surface heat is a hot-season Landsat baseline (a median of the last three years), not today's reading. The Studio also shows today's air temperature and AQI.
- All cooling numbers are estimates from a surrogate model; every coefficient and its source is listed on the "Method & assumptions" page.
