"""App factory: middleware, routers, and the built web app (one Cloud Run service serves both)."""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api import deps, errors
from app.api.routes import ALL
from app.config import WEB_DIR


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
    deps.purge_expired()  # expired plans and areas go at start-up (and hourly while saving)
    if WEB_DIR.is_dir():  # registered last so API routes win
        app.mount("/", SPAFiles(directory=WEB_DIR, html=True), name="web")

        @app.middleware("http")
        async def pages_win_for_browsers(request: Request, call_next):
            # Some page URLs are also API paths (/vendors, /assumptions). A browser loading or reloading the page asks for HTML;
            # the app's own fetches don't, so they still reach the API. `Vary: Accept` keeps the browser from answering the
            # app's fetch with the cached page (one URL, two representations).
            if request.method == "GET" and "text/html" in request.headers.get("accept", "") and "." not in request.url.path.rsplit("/", 1)[-1]:
                response = FileResponse(WEB_DIR / "index.html")
            else:
                response = await call_next(request)
            response.headers["Vary"] = ", ".join(v for v in (response.headers.get("Vary"), "Accept") if v)
            return response
    return app


app = create_app()
