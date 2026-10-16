# One Cloud Run service: the FastAPI API plus the built React app it serves.
#
#   docker build --build-arg VITE_GOOGLE_MAPS_API_KEY=<browser key> -t leafit .
#
# The Maps key is a *browser* key (restricted by HTTP referrer), so it is compiled into the JS on purpose.
# Server-side secrets are NOT in the image: on Cloud Run, Earth Engine authenticates as the service's runtime service
# account (grant it Earth Engine + Service Usage roles); set EE_PROJECT, GEMINI_API_KEY, GOOGLE_MAPS_SERVER_KEY as env vars.

# ── stage 1: build the web app ──────────────────────────────────────────────
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json frontend/
RUN cd frontend && npm ci
COPY frontend frontend
COPY shared shared
ARG VITE_GOOGLE_MAPS_API_KEY=""
ENV VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY
RUN cd frontend && npm run build

# ── stage 2: API + static files ─────────────────────────────────────────────
FROM python:3.12-slim
WORKDIR /srv
COPY backend/requirements.txt backend/
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY shared shared
COPY backend/app backend/app
COPY backend/data/blocks backend/data/blocks
COPY backend/data/vendors.json backend/data/
COPY --from=web /web/frontend/dist frontend/dist
ENV LEAFIT_WEB_DIR=/srv/frontend/dist
WORKDIR /srv/backend
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}
