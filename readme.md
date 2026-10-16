# LeafIt

**Redesign your block. Leave it greener.**
An AI-powered climate intervention simulator, built by Friendly Neighbourhood Devs.

Search for a real place, mark out your neighbourhood on the satellite map, and test trees, cool roofs and shaded bus stops on a 2.5D isometric twin of it. Cooling, heat exposure, CO₂, air quality and cost update as you place things. A Gemini planner can propose a plan within your budget, and local vendors turn it into a quote.

## How it works

1. **Find your place.** `/explore` is a Google satellite map that opens at your location. Search a place, then drag a box over the area (200 m up to about 1 km², no side over 1.5 km). The size is shown live and the box snaps back inside the limits.
2. **Build the area.** `POST /areas` fetches real data from Google Earth Engine: Landsat surface temperature, ESA WorldCover land cover, and Open Buildings footprints and heights. It also adds live weather, air quality and nearby landmarks. Built areas are cached.
3. **Work on it in 2.5D.** `/area/:id` is a three.js isometric diorama with the satellite photo as the ground. Place trees (or paint them by dragging), coat roofs, add shaded stops, erase, undo, and turn the view.
4. **Live numbers.** The cooling model runs in a Web Worker in your browser on every change. The server runs the same model for Review, saved plans and the agent.
5. **Plan, quote, share.** Review gives the server-computed before/after, a bill of materials, a funding proposal and vendor quote links.

## Architecture

```
shared/
  model.json            model coefficients, placement rules, area limits (the single source of truth)
  fixtures/golden.json  cases replayed by BOTH test suites, so browser and server cannot drift
backend/app/            FastAPI
  routers/              one file per resource (blocks, areas, simulate, agent, photo, plans, vendors)
  domain/               sim.py (cooling model), optimise.py (greedy planner), market.py (BOM, vendors)
  agents/               Gemini planner, photo audit, proposal writer
  geodata/              Earth Engine, live conditions, Places landmarks, area assembly
  store.py              persistence behind one interface (files today, Firestore later)
frontend/src/           React 19 + Vite
  features/             home, explore (map), studio (diorama), summary, vendors, method, photo
  model/                browser simulator, its Web Worker, and parity tests
  app/                  routes (lazy loaded), session store, block loader
```

Performance choices: the three.js scene renders only when something changes (an idle GPU does nothing), uses about 9 draw calls (all buildings are one mesh, trees are GPU-billboarded instances), and loads only on the Studio route. The Maps SDK loads only on the Explore route. The simulator never blocks the UI thread.

## Setup

Requires conda, Node 22+ and Docker (only for the image).

### 1. Backend

```bash
conda create -n leafit python=3.12 -y
conda activate leafit
pip install -r backend/requirements.txt
cd backend
uvicorn app.main:app --reload --port 8000
```

### 2. Web app

```bash
cd frontend
cp .env.example .env.local        # then put your browser Maps key in it
npm install
npm run dev                       # http://localhost:5173 (API calls are proxied to :8000)
```

### 3. Tests

```bash
cd backend  && python test_backend.py      # backend suite, golden fixtures, area pipeline (no network needed)
cd frontend && npm test                    # browser simulator parity, geometry, placements, limits, tiles
cd frontend && npm run build               # production build
python backend/scripts/ee_smoke.py         # LIVE Earth Engine check (needs the setup below)
```

After changing the model on purpose: edit `shared/model.json`, then `python backend/scripts/make_golden.py` and re-run both suites.

## Configuration

| Variable | Where | Purpose |
|---|---|---|
| `VITE_GOOGLE_MAPS_API_KEY` | `frontend/.env.local` | Browser key: Maps JavaScript, Places (New), Map Tiles |
| `GOOGLE_APPLICATION_CREDENTIALS` | backend env | Path to the Earth Engine service-account key. Defaults to `EarthCredentials.json` at the repo root |
| `EE_PROJECT` | backend env | Earth Engine cloud project (defaults to the key's project) |
| `GOOGLE_MAPS_SERVER_KEY` | backend env | Optional: Places landmarks and Air Quality. Without it landmarks are empty and AQI uses a default |
| `GEMINI_API_KEY` | backend env | Planner agent, photo audit, proposals. Without it the planner uses simple rules and the photo audit is disabled |
| `LEAFIT_ALLOW_SYNTHETIC_AREAS=1` | backend env | Dev only: if Earth Engine is unreachable, build a clearly labelled **synthetic stand-in** instead of an error |

Templates: `frontend/.env.example`, `backend/.env.example`. Real keys are never committed: `.env*` files and credential JSON files are excluded from git, Docker builds and `gcloud --source` uploads.


## Deploy (Cloud Run)

```bash
docker build --build-arg VITE_GOOGLE_MAPS_API_KEY=<browser key> -t leafit .
docker run -p 8080:8080 -e GEMINI_API_KEY=... -e EE_PROJECT=... leafit
```

One container serves the API and the built web app. On Cloud Run, do not ship a key file: attach a service account (with the two Earth Engine roles above) to the service. Built areas are cached on local disk, which Cloud Run loses on restart; move `store.py` to Firestore or GCS when that matters.

## Known limits

- Roofs are modelled per 10 m cell, so coating one building can include a neighbour's share of a shared cell.
- Surface heat is a hot-season Landsat baseline (a median of the last three years), not today's reading. The Studio also shows today's air temperature and AQI.
- All cooling numbers are estimates from a surrogate model; every coefficient and its source is listed on the "Method & assumptions" page.
