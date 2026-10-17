# LeafIt: hackathon submission

| Requirement | Deliverable | Status |
|---|---|---|
| Category | **Sustainability** | done |
| Proposal deck (PDF) | `docs/submission/LeafIt_Deck.pdf` (11 slides, source: `deck.html`) | fill in `{{LIVE_URL}}` / `{{VIDEO_URL}}` on slide 11, then re-export |
| Prototype on Google Cloud, using Google Cloud AI | `./deploy.sh`: Cloud Build → Artifact Registry → Cloud Run, Gemini on **Vertex AI**, Earth Engine | run after `gcloud auth login` |
| 3-minute public video | script below; upload to YouTube as **Public/Unlisted** | record after deploying |

Re-export the deck after editing:

```bash
cd docs/submission && "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --allow-file-access-from-files --no-pdf-header-footer --print-to-pdf=LeafIt_Deck.pdf deck.html
```

## Before you record or submit

1. `gcloud auth login`, then `./deploy.sh` from the repo root.
2. Add the `https://leafit-…run.app/*` URL to the browser Maps key's HTTP-referrer allow-list, or the map stays blank.
3. Check the models in `backend/.env` (`LEAFIT_GEMINI_MODEL`, `LEAFIT_PLANNER_MODEL`) are available on **Vertex AI** in your project
   (`deploy.sh` passes them to Cloud Run). If a model isn't offered on Vertex, use `gemini-2.5-flash`.
4. Run one plan on the live URL before recording (the first Earth Engine build of a new area takes ~10–30 s).

## Short description (paste into the form)

LeafIt is a Gemini planning agent for neighbourhood heat. Draw any area on a Google satellite map and LeafIt builds a digital twin from
nine real data sources: Landsat surface heat, building footprints and heights, 1 m tree-canopy height, residents by age (Earth Engine),
roads, landmarks, air quality and climate. Brief Gemini in plain words ("protect people waiting at bus stops and elderly residents") and,
through function calling, it tests 2–4 strategies on a physics-based simulator, critiques each with a check that code enforces (it cannot
recommend a plan that wastes trees in existing shade), and explains its choice zone by zone. Every number comes from the simulator and
any figure Gemini invents is flagged. Users browse and compare every option, then Gemini drafts a funding proposal and real local
vendors get a ready quote request. Category: Sustainability. Runs on Cloud Run with Gemini on Vertex AI.

## How LeafIt meets each judging criterion

| Criterion (weight) | What to point judges at | Where |
|---|---|---|
| **Meaningful use of Gen AI** (part of 40%) | Gemini makes the decision a planner would: which trade-off fits *this* brief (street cooling vs cooler homes vs shade at bus stops), which the simulator alone can't rank. It also turns the plan into a funding proposal a city or CSR team can act on. | Deck 5–6; Studio → Ask AI; Review → Write the proposal |
| **Technical implementation** (40%) | Function-calling agent (5 tools, ≤16 turns, thinking budget, structured-JSON answer), multimodal input (two generated maps), code-enforced self-critique, numbers guardrail; 9-source Earth Engine/Maps pipeline; 156 offline tests including the agent loop with a scripted Gemini. | Deck 4, 5, 9; `backend/app/agents/`, `backend/tests/` |
| **Scalability & sustainability** (40%) | Stateless Cloud Run, Vertex AI (no key shipped, no free-tier limits), simulator runs in the browser, cache moves to Firestore/GCS by swapping one layer; works across Open Buildings' coverage (Africa, South & SE Asia, Latin America). | Deck 10; `deploy.sh`, `backend/app/repositories/` |
| **Problem alignment** (25%) | Urban heat is the Sustainability problem; LeafIt goes from "where is it hot" to a funded, quoted plan, aimed at the people who actually spend the money (RWAs, ward officers, NGOs/CSR). | Deck 2–3, 7 |
| **Potential impact** (25%) | Shows *who* each option helps: street cooling, residents under cool roofs, cooling where vulnerable people live, shaded bus stops. | Deck 7; plan check in the AI result |
| **Originality** (25%) | An agent that operates a real simulator and is held to its own critique, instead of a chatbot over a dashboard; existing shade and equity built into the model. | Deck 8 |
| **Innovation in Gen AI** (25%) | Self-critique enforced in code (refusal → revision loop), vision on generated maps labelled with the tools' zone grid, guardrail that tolerates unit rescaling, honest failure (no fake plan). | Deck 5, 8 |
| **Usability & accessibility** (10%) | Plain-language brief, live budget used/left with validation, browse & compare every AI option, reopenable "About this plan" card, keyboard shortcuts, ARIA labels, light/dark, 14 currencies, 375 px to ultrawide. | Deck 9; the demo |
| **Experience & integration** (10%) | One flow: map → twin → AI plan → compare → review → proposal → vendors, with the same budget and prices everywhere. | The video |

## Video script (≈3:00)

Record on the **deployed URL** with QuickTime (File → New Screen Recording) at 1080p, voice over live. Before recording, open Lajpat Nagar
once so it is cached, and have a brief ready to paste.

| Time | On screen | Say |
|---|---|---|
| 0:00–0:15 | Deck slide 2 | "Cities are getting hotter, and the money to cool them is spent blind. LeafIt lets a neighbourhood test a plan, and get it funded and built, before spending a rupee." |
| 0:15–0:40 | Explore: search "Lajpat Nagar", drag a box; the twin builds | "I draw my area on a Google satellite map. Earth Engine builds a digital twin from nine real sources: three years of Landsat heat, every building and its height, today's tree canopy at one metre, and who lives where." |
| 0:40–1:00 | Studio: place a few trees and a roof; numbers and budget bar move; try to over-spend → refusal toast | "I can design by hand: cooling, CO₂, air quality and cost update instantly, and the budget stops me spending money I don't have." |
| 1:00–1:45 | Ask AI: type "Protect people waiting at bus stops and elderly residents in dense homes", ₹20 lakh, Plan it. Open the reasoning trail. | "Or I brief Gemini in plain words. It reads a brief of the place and two maps, then calls our simulator as tools to test different strategies, checks each one, and in code it isn't allowed to recommend a plan that wastes trees in shade that already exists. Every number it writes is checked against the simulator." |
| 1:45–2:10 | Tap each option card to show its breakdown; Apply Gemini's pick; show the "About this plan" card, close and reopen it, tap Show on a zone | "I can browse every option it tested, by species and by zone. Here roofs cool 620 residents' homes and a shelter shades a bus stop; that's why Gemini picked it over the option with the most street cooling." |
| 2:10–2:25 | Plan options → Compare | "All options land in compare, side by side, with my own plan." |
| 2:25–2:50 | Review: before/after slider, Save, bill of materials by species, Write the proposal (point at "every number checked"), Vendors with a quote | "Review gives the bill of materials, and Gemini drafts a funding proposal for a ward officer or a CSR committee, again with every figure checked. Then real nurseries and contractors nearby, with the quote message written." |
| 2:50–3:00 | Deck slide 11 | "LeafIt runs on Cloud Run with Gemini on Vertex AI. Redesign your block. Leave it greener." |
