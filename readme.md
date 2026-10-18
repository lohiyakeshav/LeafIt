# LeafIt

**Redesign your block. Leave it greener.** · Live: **https://leafit.cloud.run**
An AI-powered climate intervention simulator, built by Friendly Neighbourhood Devs.

Search for a real place, mark out your neighbourhood on the satellite map, and test trees, cool roofs and shaded bus stops on a 2.5D isometric twin of it. Cooling, heat exposure, CO₂, air quality and cost update as you place things. A Gemini planner can propose a plan within your budget (it inspects the place, tests several options on the simulator, checks and revises its own plan), and local vendors turn it into a quote.

## How it works

1. **Find your place.** `/explore` is a Google satellite map that opens at your location. Search a place, then drag a box over the area (200 m up to about 1 km², no side over 1.5 km). The size is shown live and the box snaps back inside the limits.
2. **Build the area.** `POST /areas` fetches real data from Google Earth Engine: Landsat surface temperature, ESA WorldCover land cover, and Open Buildings footprints and heights. It also reads Meta/WRI tree-canopy height (existing trees, with a 150 m ring of surroundings), WorldPop population by age, OpenStreetMap roads and places (Overpass), the hot-season climate class, live weather, air quality and nearby landmarks. Built areas are cached; one built while Overpass was down is rebuilt next time.
3. **Work on it in 2.5D.** `/area/:id` is a three.js isometric diorama with the satellite photo as the ground. Place trees (or paint them by dragging), coat roofs, add shaded stops, erase, undo, and turn the view.
4. **Live numbers.** The cooling model runs in a Web Worker in your browser on every change. The server runs the same model for Review, saved plans and the agent.
5. **Review and build.** Review shows the measured heat against your plan on the satellite photo, with a bill of materials and a funding proposal; Vendors finds suppliers within 25 km and writes the quote request.
6. **Your prices, your currency.** Tree, cool-roof and bus-stop prices and the budget are editable; money can be shown in 14 currencies at today's rates (all maths stays in INR).

## How the numbers are calculated

Every figure comes from a grid model on 10 m cells, not from the AI. Each cell starts at its measured Landsat surface temperature; each tree, cool roof or shelter spreads its effect over nearby cells. Published studies of tree cooling differ about eightfold, so street cooling is shown as a **range**: low end from Ruiz-Valero et al. 2025 (half canopy cover lowers surface temperature by 0.268 °C), high end from Schwaab et al. 2021 (tree-covered areas up to 4 °C cooler than built-up ones in southern Europe). Every coefficient is cited, derived from cited figures, or labelled a modelling choice on the in-app **Method** page (`/assumptions`, served from `backend/app/domain/assumptions.py`). Gemini only chooses between options and explains them; every number it writes is checked against the simulator.

## Architecture

New to the code? Read **[ARCHITECTURE.md](ARCHITECTURE.md)**: how the pieces fit, the dependency rules, the design principles and where each shows, and a "where do I…" table.

```
shared/      model.json (the model's numbers and rules, read by both simulators) + golden fixtures
backend/     FastAPI: api/routes → services/ → repositories/ (+ domain/, agents/, integrations/)
flutter_app/ Flutter mobile client (talks to the same API)
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
cd backend  && .venv/bin/python -m pytest && .venv/bin/ruff check .   # 115 tests, offline; lint
cd frontend && npm test && npm run lint && npm run build               # 42 tests: simulator parity, geometry, money…; lint; build
```

After changing the model on purpose: edit `shared/model.json`, then `.venv/bin/python scripts/make_golden.py` (from `backend/`) and re-run both suites.

## Configuration

| Variable | Where | Purpose |
|---|---|---|
| `VITE_GOOGLE_MAPS_API_KEY` | `frontend/.env.local` | Browser key: Maps JavaScript, Places (New), Map Tiles |
| `GOOGLE_MAPS_BROWSER_KEY` | backend env | The same browser key, served to the web app at runtime (`/config.js`); use it when the image is built without the build arg, e.g. Cloud Run's deploy-from-GitHub |
| `GOOGLE_APPLICATION_CREDENTIALS` | backend env | Path to the Earth Engine service-account key. Defaults to `EarthCredentials.json` at the repo root |
| `EE_KEY_FILE` | backend env | Earth Engine key path read by Earth Engine only (wins over `GOOGLE_APPLICATION_CREDENTIALS`). Use it on Cloud Run when the key comes from another project, mounted as a secret, so Gemini on Vertex keeps the service's own identity |
| `EE_PROJECT` | backend env | Earth Engine cloud project (defaults to the key's project) |
| `GOOGLE_MAPS_SERVER_KEY` | backend env | Places (landmarks and real nearby vendors) and Air Quality. Without it there are no landmarks, no vendors and no AQI figure (nothing is made up) |
| `GEMINI_API_KEY` | backend env | Google AI Studio key for the planner agent and funding proposals. Without Gemini the planner returns a clear 503 (no made-up plan) and proposals use a labelled template |
| `GOOGLE_CLOUD_PROJECT` | backend env | Use Gemini on Vertex AI with the runtime service account instead of a key (what `deploy.sh` sets on Cloud Run); `GOOGLE_CLOUD_LOCATION` defaults to `global` |
| `LEAFIT_VERTEX_CREDENTIALS` | backend env | Use Vertex AI (billed to a project, no free-tier rate limits) with this service-account key, path relative to `backend/`. `LEAFIT_GEMINI_BACKEND=studio\|vertex` picks one when both this and `GEMINI_API_KEY` are set (default prefers the key). Key files named `*vertex*.json` are git-ignored |
| `LEAFIT_GEMINI_DAILY_CALLS` | backend env | Spending guard: Gemini calls allowed per day per server instance (default 600, about 50–100 AI plans; 0 = no limit). Past it, the planner says so and proposals use the template |
| `LEAFIT_GEMINI_MODEL` | backend env | Model for the proposal writer (default `gemini-2.5-flash`) |
| `LEAFIT_PLANNER_MODEL` | backend env | Model for the planner agent (defaults to `LEAFIT_GEMINI_MODEL`); `LEAFIT_PLANNER_THINKING` sets its reasoning-token budget (default 1024, 0 = off) |

Templates: `frontend/.env.example`, `backend/.env.example`. Real keys are never committed: `.env*` files and credential JSON files are excluded from git, Docker builds and `gcloud --source` uploads.


## Deploy (Cloud Run)

```bash
gcloud auth login
./deploy.sh          # Cloud Build -> Artifact Registry -> Cloud Run (asia-south1); PROJECT / REGION / SA can be overridden
```

One container serves the API and the built web app. No Gemini key or key file ships: Gemini runs on Vertex AI and Earth Engine reads
satellites as the service's runtime service account (Earth Engine + Service Usage roles; `deploy.sh` adds `roles/aiplatform.user`).
Live at **https://leafit.cloud.run** (custom URL; the service's own `run.app` URL also works). Both must be in the browser Maps key's allowed referrers. Local Docker: `docker build --build-arg VITE_GOOGLE_MAPS_API_KEY=<browser key> -t leafit .` Built areas are cached on local disk, which Cloud Run loses on restart; re-implement `backend/app/repositories/` on Firestore or GCS when that matters.

## The sample area

`/block/lajpat_nagar` (also on the home page) is Lajpat Nagar Central Market, New Delhi: a 700 m × 700 m area built from the same
real data as any area you draw, and shipped in `backend/data/blocks/` so it opens instantly. There is no synthetic or demo data
in the app: if Earth Engine is down, building a new area fails with a clear error instead. To rebuild the sample (or add another):

```bash
cd backend && .venv/bin/python scripts/build_sample.py            # defaults: Lajpat Nagar Central Market
.venv/bin/python scripts/build_sample.py --id my_place --name "My place" --lat 28.6 --lng 77.2 --size 700
```

The tests and the browser/server parity fixtures (`shared/fixtures/golden.json`, regenerated by `scripts/make_golden.py`) run on
this sample too.

## Evaluating the planner

`backend/scripts/agent_eval.py` builds Lajpat Nagar and Gachibowli from real data (cached in `backend/data/eval_areas`) and runs six briefs through the Gemini agent. It prints per run: trees on already-shaded ground, zones and species used, numbers in the prose that no tool produced, surface / air / equity cooling, cost per degree and seconds. Free-tier Gemini keys allow about five requests a minute per model, so a full run takes a while; the client waits out rate-limit replies instead of failing.

## Known limits

- Roofs are modelled per 10 m cell, so coating one building can include a neighbour's share of a shared cell.
- Surface heat is a hot-season Landsat baseline (a median of the last three years), not today's reading. The Studio also shows today's air temperature and AQI.
- Existing trees come from canopy imagery that is mostly 2018–2020; trees planted or cut since are not seen. Air cooling and the humid-climate spacing limit are literature-based estimates (see the Method page), not measurements. Species crown sizes are size-class estimates.
- Overpass (OpenStreetMap) is a free public service and fails some requests; the builder retries several mirrors, and an area built without it is rebuilt on the next request.
- All cooling numbers are estimates from a surrogate model; every coefficient and its source is listed on the "Method & assumptions" page.
