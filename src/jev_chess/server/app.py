"""Serves the built React UI and its configuration schema next to the graph API.

Mounted under `/ui`, never `/`: custom routes shadow the server's own, and `/` is its health
check while `/threads`, `/runs`, `/assistants` are what the UI talks to. The static directory
is the Vite build output, produced in CI right before `langgraph deploy`; it is absent in a
plain checkout, so the mount is conditional and `/ui/config` still answers.
"""

from dataclasses import asdict
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import TypeAdapter

from jev_chess.graphs.context import PlayContext

STATIC_DIR = Path(__file__).parent / "static"
GRAPH_IDS = ("game", "jev", "llm", "hybrid")


def ui_config() -> dict[str, Any]:
    """What the UI needs to build its settings form: schema, defaults, graph ids."""
    return {
        "graphs": list(GRAPH_IDS),
        "game_graph": "game",
        "schema": TypeAdapter(PlayContext).json_schema(),
        "defaults": asdict(PlayContext()),
    }


def create_app(static_dir: Path | None = STATIC_DIR) -> FastAPI:
    app = FastAPI(title="jev-chess ui", docs_url=None, redoc_url=None, openapi_url=None)

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
