# LeafIt: hackathon submission

| Requirement | Deliverable | Status |
|---|---|---|
| Theme | **Sustainability & Social Impact** | done |
| Proposal deck | `docs/submission/LeafIt_Submission.pptx` (14 slides, AI Builder Cup template) and its PDF | add the video link on slide 13 |
| Prototype on Google Cloud, using Google Cloud AI | **https://leafit.cloud.run**: Cloud Run (deployed from GitHub `main` by a Cloud Build trigger), Gemini on **Vertex AI**, Earth Engine | live |
| 3-minute public video | script below; upload to YouTube as **Public/Unlisted** | to record |

## Before you record or submit

1. Push to `main` so the trigger deploys the current code. `./deploy.sh` is only needed to change the service's settings (model, keys, memory).
2. The browser Maps key must allow `https://leafit.cloud.run/*` and the service's `run.app` URL, or the map stays blank.
3. Run one plan on the live URL before recording (the first Earth Engine build of a new area takes ~10–30 s).

## Short description (paste into the form)

LeafIt is a Gemini planning agent for neighbourhood heat. Draw any area on a Google satellite map and LeafIt builds a digital twin from
real data: Landsat surface heat, building footprints and heights, 1 m tree-canopy height and residents by age (Earth Engine), roads,
landmarks, air quality and climate. Brief Gemini in plain words ("protect elderly residents in dense homes") and, through function
calling, it tests 2–4 strategies on a simulator, critiques each with a check that code enforces (it cannot recommend a plan that wastes
trees in existing shade), and explains its choice zone by zone. Every number comes from the simulator, every coefficient is cited on an
in-app Method page, and cooling is shown as a low–high range because published studies differ. Users compare every option, then Gemini
drafts a funding proposal and real local vendors get a ready quote request. Runs on Cloud Run with Gemini on Vertex AI.

## How LeafIt meets each judging criterion

| Criterion (weight) | What to point judges at | Where |
|---|---|---|
| **Meaningful use of Gen AI** (part of 40%) | Gemini makes the decision a planner would: which trade-off fits *this* brief (street cooling vs cooler homes vs shade at bus stops), which the simulator alone can't rank. It also turns the plan into a funding proposal. | Deck 5, 10, 11; Studio → Ask AI; Review → Write the proposal |
| **Technical implementation** (40%) | Function-calling agent (5 tools, ≤16 turns, thinking budget, structured-JSON answer), vision on two generated maps, code-enforced self-critique, numbers guardrail; Earth Engine/Maps pipeline; 157 offline tests including the agent loop with a scripted Gemini. | Deck 5, 7, 8, 11; `backend/app/agents/`, `ARCHITECTURE.md` |
| **Scalability & sustainability** (40%) | Stateless Cloud Run that scales to zero, Vertex AI with a daily call guard, simulator runs in the browser, storage behind one repository layer. | Deck 7, 9, 12 |
| **Problem alignment** (25%) | Urban heat is the sustainability and social-impact problem; LeafIt goes from "where is it hot" to a funded, quoted plan, for the people who spend the money (RWAs, ward officers, NGOs/CSR). | Deck 1–3 |
| **Potential impact** (25%) | Shows *who* each option helps: street cooling, residents under cool roofs, cooling where vulnerable people live. | Deck 11 (real run) |
| **Originality** (25%) | An agent that operates a real simulator and is held to its own critique, instead of a chatbot over a dashboard; existing shade and equity built into the model. | Deck 3, 4 |
| **Innovation in Gen AI** (25%) | Self-critique enforced in code (refusal → revision loop), vision on generated maps labelled with the tools' zone grid, numbers guardrail, honest failure (no fake plan). | Deck 5 |
| **Usability & accessibility** (10%) | Plain-language brief, live budget used/left, compare every AI option, keyboard shortcuts, ARIA labels, light/dark, 14 currencies, 375 px to ultrawide. | Deck 6, 10; the demo |
| **Experience & integration** (10%) | One flow: map → twin → AI plan → compare → review → proposal → vendors, with the same budget and prices everywhere. | The video |

## Video script (≈3:00)

Record on **https://leafit.cloud.run** at 1080p, voice over live. Open Lajpat Nagar once first so it is cached.

| Time | On screen | Say |
|---|---|---|
| 0:00–0:15 | Deck slide 2 | "Cities are getting hotter, and the money to cool them is spent blind. LeafIt lets a neighbourhood test a plan, and get it funded and built, before spending a rupee." |
| 0:15–0:40 | Explore: search "Lajpat Nagar", drag a box; the twin builds | "I draw my area on a Google satellite map. Earth Engine builds a digital twin from real data: Landsat heat, every building and its height, today's tree canopy at one metre, and who lives where." |
| 0:40–1:00 | Studio: place a few trees and a roof; numbers and budget bar move | "I can design by hand: cooling, CO₂ and cost update instantly. Cooling is a range, because published studies disagree, and the Method page cites every number." |
| 1:00–1:45 | Ask AI: "Keep shoppers at Lajpat Nagar Market and children walking to school cool, and protect elderly residents in dense homes", ₹20 lakh, Plan it | "I brief Gemini in plain words. It calls our simulator as tools to test strategies, checks each one in code, and isn't allowed to recommend a plan that wastes trees in existing shade. Every number it writes is checked against the simulator." |
| 1:45–2:10 | Open each option; Apply Gemini's pick; show "About this plan" | "It tested three options. It picked the one that puts 497 residents, 61 of them vulnerable, under cool roofs, over the option with the most street cooling, because that is what the brief asked for." |
| 2:10–2:50 | Compare; Review (before/after, Save, bill of materials, Write the proposal); Vendors | "Review gives the bill of materials by species and a funding proposal for a ward officer or CSR committee, with every figure checked. Then real nurseries and contractors nearby, with the quote written." |
| 2:50–3:00 | Deck slide 14 | "LeafIt runs on Cloud Run with Gemini on Vertex AI. Redesign your block. Leave it greener." |
