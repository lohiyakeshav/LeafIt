#!/usr/bin/env bash
# Build on Cloud Build and deploy to Cloud Run. Run from the repo root after `gcloud auth login`.
# Gemini runs on Vertex AI and Earth Engine reads satellites, both as the service account below: no Gemini key ships.
set -euo pipefail
PROJECT=${PROJECT:-ai-dependency-analyzer-tool}
REGION=${REGION:-asia-south1}
SA=${SA:-earth-engine-api@$PROJECT.iam.gserviceaccount.com}
IMAGE=$REGION-docker.pkg.dev/$PROJECT/leafit/leafit
env_of() { grep "^$1=" "$2" | tail -1 | cut -d= -f2-; }
MAPS_KEY=$(env_of VITE_GOOGLE_MAPS_API_KEY frontend/.env.local)        # browser key: allow https://leafit.cloud.run/* (and the run.app URL)
SERVER_KEY=$(env_of GOOGLE_MAPS_SERVER_KEY backend/.env)               # Places (landmarks, vendors) + Air Quality
MODEL=$(env_of LEAFIT_GEMINI_MODEL backend/.env); MODEL=${MODEL:-gemini-2.5-flash}
PLANNER=$(env_of LEAFIT_PLANNER_MODEL backend/.env); PLANNER=${PLANNER:-$MODEL}

gcloud config set project "$PROJECT"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  aiplatform.googleapis.com earthengine.googleapis.com
gcloud artifacts repositories describe leafit --location "$REGION" >/dev/null 2>&1 ||
  gcloud artifacts repositories create leafit --repository-format docker --location "$REGION"
gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$SA" \
  --role roles/aiplatform.user --condition None >/dev/null

gcloud builds submit --config cloudbuild.yaml --substitutions "_IMAGE=$IMAGE,_MAPS_KEY=$MAPS_KEY" .
# 180 s timeout: one planner run is several Gemini calls with thinking
gcloud run deploy leafit --image "$IMAGE" --region "$REGION" --service-account "$SA" \
  --allow-unauthenticated --memory 2Gi --cpu 2 --timeout 180 \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=$PROJECT,LEAFIT_GEMINI_BACKEND=vertex,EE_PROJECT=$PROJECT,LEAFIT_GEMINI_MODEL=$MODEL,LEAFIT_PLANNER_MODEL=$PLANNER,GOOGLE_MAPS_SERVER_KEY=$SERVER_KEY,GOOGLE_MAPS_BROWSER_KEY=$MAPS_KEY"
