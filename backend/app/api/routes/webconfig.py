import json

from fastapi import APIRouter, Response

from app import config

router = APIRouter(tags=["config"])


@router.get("/config.js", include_in_schema=False)
def web_config():
    """Runtime settings for the web app, loaded by index.html before the app starts."""
    body = f"window.LEAFIT_CONFIG = {json.dumps({'mapsKey': config.GOOGLE_MAPS_BROWSER_KEY})};"
    return Response(body, media_type="application/javascript", headers={"Cache-Control": "no-cache"})
