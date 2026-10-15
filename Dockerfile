# One Cloud Run service: FastAPI API + the Flutter web build it serves.
# Build the web app first: (cd app && flutter build web --release)
FROM python:3.12-slim
WORKDIR /srv
COPY backend/requirements.txt backend/
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/app backend/app
COPY backend/data/blocks backend/data/blocks
COPY backend/data/vendors.json backend/data/
COPY app/build/web app/build/web
WORKDIR /srv/backend
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}
