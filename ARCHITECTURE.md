# LeafIt architecture

Start here if you are new to the code. It explains how the pieces fit, where each kind of code lives, and the few rules that keep it that way.

## The system in one picture

```
 Browser (React, frontend/)                                   Server (FastAPI, backend/)
 ┌──────────────────────────────────────────┐                ┌──────────────────────────────────────────┐
 │ features/  pages: home, explore, studio, │   /areas       │ api/routes   HTTP only, one file per      │
 │            summary, vendors, method      │ ─────────────► │              resource                     │
 │ model/     the cooling simulator (live,  │   /simulate    │ services/    use-cases: build an area,    │
 │            in a Web Worker)              │   /plans …     │              write a proposal, FX rates   │
 │ shared/    ui kit, layout, metrics,      │ ◄───────────── │ domain/      pure logic: simulator,       │
 │            heatmap, lib (money, links)   │   JSON         │              optimiser, BOM, area geometry│
 │ state/     session + currency stores     │                │ agents/      Gemini planner + proposal    │
 │ api/       HTTP client + endpoints       │                │ integrations/ Earth Engine, Places, Air   │
 └───────────────────┬──────────────────────┘                │              Quality, Gemini client       │
                     │ Maps JS, Places, Map Tiles             │ repositories/ plans, areas, FX (files)     │
                     ▼                                        └──────────────────┬───────────────────────┘
               Google Maps Platform                     Earth Engine (Landsat, WorldCover, Open Buildings),
                                                        Places, Air Quality, Gemini, exchange rates
              ┌─────────────────────────────────────────────────────────────┐
              │ shared/model.json  the model's numbers and placement rules, │
              │ read by BOTH simulators; shared/fixtures/golden.json keeps  │
              │ them identical (both test suites replay it)                 │
              └─────────────────────────────────────────────────────────────┘
```

## The main flows

1. **Pick a place** (`/explore`). Google Maps in the browser. The user drags a box; the browser checks the size against `shared/model.json` limits before asking the server.
2. **Build the area** (`POST /areas` → `services/area_service.py` → `services/area_builder.py`). Earth Engine returns surface heat, land cover and building footprints for the box; Places and Air Quality add landmarks and live AQI. The result is a *block* (a 10 m grid plus buildings), cached by `repositories/`.
3. **Design** (`/area/:id`, `features/studio/`). The 3D view (`diorama/`) draws the block; every placement re-runs the simulator in a Web Worker (`model/`), so numbers update instantly with no network call.
4. **Review** (`/summary`). The server re-runs the same simulator (`POST /simulate`) for the canonical numbers, saves the plan (`POST /plans`), builds the bill of materials and, on request, a funding proposal (`services/plan_service.py` → `agents/proposal.py`).
5. **Build** (`/vendors`). Suppliers within 25 km (`domain/market.py`), and a quote message ready for WhatsApp or email.
6. **Ask AI** (`POST /agent`, `agents/agent.py`). Gemini reads a place brief and two labelled maps, tests 2–4 strategies through the optimiser and simulator (its tools), critiques them (`agents/checks.py`), and explains its pick. Code refuses plans that waste trees in existing shade, so it must revise. Every option comes back with what it puts where, so the user can browse and compare them all. Every number in the answer comes from the simulator; invented numbers are flagged. Without Gemini the endpoint says so (503) instead of inventing a plan.

## Dependency rules

Arrows point from the code that imports to the code it imports. Nothing imports "upwards".

**Backend:** `api/routes → services → repositories`; `services` also use `agents, domain, integrations`; route handlers and the service methods they call share one name; everything may read `config`.
- `domain/` is pure: no files, no network, no FastAPI. It can be tested with plain values.
- `integrations/` is the only place that talks to outside systems, and only `services/` and `agents/` use it. Swapping a provider means changing one file.
- `repositories/` is the only place that reads or writes files. Moving to Firestore means re-implementing those classes.
- `api/` turns HTTP into calls and errors into status codes; it holds no business rules.

**Frontend:** `app → features → (shared, model, state, api)`.
- `features/<page>` may import from `shared/`, `model/`, `state/`, `api/`, never from another feature. Code two pages need moves down a layer (e.g. `model/placements.js`, `api/mapTiles.js`).
- `shared/` never imports from `features/`. `shared/ui` is the design system: small primitives with no app knowledge.
- `model/` is pure maths plus its Web Worker; it does not import React components.

## Design principles, and where they show

| Principle | In the code |
|---|---|
| Single responsibility | One file per resource in `api/routes`, one service per use-case (`services/*_service.py`), one adapter per outside system (`integrations/`). The simulator (`domain/sim.py`) and its sources (`domain/assumptions.py`) are separate. |
| Dependency inversion | Services receive their collaborators in their constructors; `api/deps.py` is the one place that wires them (FastAPI `Depends`). Routes never build a service or touch a file. |
| Open/closed | A new data source is a new module in `integrations/`; a new storage backend re-implements `repositories/` without touching services. |
| DRY | The model's numbers exist once (`shared/model.json`) for both simulators; golden fixtures prove the two agree. The Method page reads its values from the code that uses them. Display formatting lives in `shared/lib/format.js`. |
| KISS | Plain functions and dataclasses for the maths (`domain/`); classes only where there is state or a dependency to inject (services, repositories, the agent session). |
| Honesty | Every coefficient is cited, derived from cited figures, or labelled a modelling choice on the Method page (`GET /assumptions`); tests fail if a cited/derived/estimate item has no source. |

## Conventions

| Topic | Rule |
|---|---|
| Money | Every amount is computed and stored in **INR**. Other currencies are display only: `shared/lib/format.js` (`inr()`, `toDisplay`, `fromDisplay`) on the web, `money()` in `agents/proposal.py` on the server. Rates come from `GET /fx` (recorded daily in `backend/data/fx/`). |
| User prices | Optional `unit_cost` (tree, cool roof per m², bus stop) on `/simulate`, `/plans`, `/agent`. Missing values use `shared/model.json`. Saved plans keep the prices they were costed with. |
| The model | Change numbers or rules only in `shared/model.json`, then regenerate `shared/fixtures/golden.json` (`python backend/scripts/make_golden.py`) and run both test suites. |
| Data on disk | All folders are defined once in `backend/app/config.py` (`DATA_DIR`, `PLANS_DIR`, …). Code never builds paths from `__file__`. |
| Errors | The API answers validation problems with one readable sentence (`api/errors.py`), never framework internals. |
| Imports | Backend: absolute `from app.x import y`. Frontend: relative paths; the design system through its barrel, `shared/ui`. |
| Theme | Colours are CSS variables in `frontend/src/styles/index.css`; light and dark are two sets of the same tokens. Never hard-code a UI colour. |

## Where do I…

| I want to… | Go to |
|---|---|
| add or change an API endpoint | `backend/app/api/routes/<resource>.py` (+ request model in `api/schemas.py`) |
| change how cooling, CO₂, AQI or cost is calculated | `shared/model.json`, then `backend/app/domain/sim.py` **and** `frontend/src/model/sim.js`; update its source in `backend/app/domain/assumptions.py` (the Method page) |
| change what the AI planner does | `backend/app/agents/agent.py` (tools + prompt), optimiser in `domain/optimise.py` |
| add a new data source | a module in `backend/app/integrations/`, used from a service |
| add a page | `frontend/src/features/<page>/`, register it in `app/routes.js` and `app/App.jsx` |
| add a reusable component | `frontend/src/shared/ui/` (export it from `shared/ui/index.js`) |
| change the 3D view | `frontend/src/features/studio/diorama/` (`DioramaScene.js` is the three.js scene) |
| change what is remembered between reloads | `frontend/src/state/session.js` (tab session) or `state/currency.js` (across visits) |

## Testing and quality gates

| Command | What it checks |
|---|---|
| `cd backend && .venv/bin/python -m pytest` | simulator physics and costs, golden parity, API and validation messages, plans → BOM → vendors → quotes, the area pipeline with Earth Engine faked, the AI planner with a scripted Gemini. Offline; writes nothing to `backend/data`. |
| `cd backend && .venv/bin/ruff check .` | undefined names, unused imports, import order, common bug patterns |
| `cd frontend && npm test` | browser simulator parity (same golden cases), geometry, placements, area limits, tiles, money and cooling formatting |
| `cd frontend && npm run lint` | undefined names, unused code, React hook rules |
| `cd frontend && npm run build` | production bundle |
