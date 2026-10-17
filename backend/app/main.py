"""App factory: middleware, routers, and the built web app (one Cloud Run service serves both)."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api import errors
from app.api.routes import ALL
from app.config import WEB_DIR
from app.storage.store import store


class SPAFiles(StaticFiles):
    """Serve the built React app; unknown non-file paths (deep links like /area/abc) fall back to index.html."""

    async def get_response(self, path, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as e:
            if e.status_code == 404 and "." not in path.rsplit("/", 1)[-1]:
                return await super().get_response("index.html", scope)
            raise


def create_app() -> FastAPI:
    app = FastAPI(title="LeafIt")
    errors.install(app)
    app.add_middleware(GZipMiddleware, minimum_size=1024)  # block/area JSON compresses ~10x
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
    for router in ALL:
        app.include_router(router)
    store.purge_expired()  # expired plans and areas go at start-up (and hourly while saving)
    if WEB_DIR.is_dir():  # registered last so API routes win
        app.mount("/", SPAFiles(directory=WEB_DIR, html=True), name="web")
    return app


app = create_app()
