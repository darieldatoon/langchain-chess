"""Serves the built web UI and its settings schema next to the graph API.

Mounted under `/ui`, never `/`: custom routes shadow the server's own, and `/` is its health
check. The static directory is the Vite build output, produced in CI right before
`langgraph deploy`; it is absent in a plain checkout, so the mount is conditional and
`/ui/config` still answers.
"""

from dataclasses import asdict
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import TypeAdapter

from langchain_chess_server.context import ChessContext

STATIC_DIR = Path(__file__).parent / "static"
GRAPH_ID = "chess"


def ui_config() -> dict[str, Any]:
    """What the UI needs to build its settings form: schema, defaults, the graph id."""
    return {
        "graph": GRAPH_ID,
        "schema": TypeAdapter(ChessContext).json_schema(),
        "defaults": asdict(ChessContext()),
    }


def create_app(static_dir: Path | None = STATIC_DIR) -> FastAPI:
    app = FastAPI(title="langchain-chess ui", docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/ui/config")
    def config() -> dict[str, Any]:
        return ui_config()

    @app.get("/ui", include_in_schema=False)
    def root() -> RedirectResponse:
        return RedirectResponse(url="/ui/")

    if static_dir is not None and static_dir.is_dir():
        app.mount("/ui", StaticFiles(directory=static_dir, html=True), name="ui")
    else:

        @app.get("/ui/", include_in_schema=False)
        def missing() -> JSONResponse:
            return JSONResponse(
                {"detail": "UI not built; run `mise run build` or use `vp dev`."}, status_code=404
            )

    return app


app = create_app()
