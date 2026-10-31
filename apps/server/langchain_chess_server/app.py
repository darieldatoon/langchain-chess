"""Serves the built web UI and its settings schema next to the graph API.

Mounted under `/ui`, never `/`: custom routes shadow the server's own, and `/` is its health
check. The static directory is the Vite build output (`mise run build`), for local runs and the
e2e tests; the deployment ships without it, since GitHub Pages hosts the UI. So the mount is
conditional and `/ui/config` and `/ui/model` still answer.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from langchain_chess.efforts import takes_effort
from langchain_chess_server.clients import DECISIONS_POOL, POOL
from langchain_chess_server.graph import model_limit
from langchain_chess_systemone.settings import ChessContext, dump

STATIC_DIR = Path(__file__).parent / "static"
GRAPH_ID = "chess"


def ui_config() -> dict[str, Any]:
    """What the UI needs to build its settings form: schema, defaults, the graph id."""
    return {
        "graph": GRAPH_ID,
        "schema": ChessContext.model_json_schema(),
        "defaults": dump(ChessContext()),
    }


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """The Agent Server merges this app's lifespan with its own, so graph clients close too."""
    try:
        yield
    finally:
        await POOL.aclose()
        await DECISIONS_POOL.aclose()


def create_app(static_dir: Path | None = STATIC_DIR) -> FastAPI:
    app = FastAPI(
        title="langchain-chess ui",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )

    @app.get("/ui/config")
    def config() -> dict[str, Any]:
        return ui_config()

    @app.get("/ui/model")
    def model_facts(model: str) -> dict[str, Any]:
        """What the new-game dialog offers: memory for a known input limit, and a reasoning
        effort unless the model is known to take none."""
        return {"max_input_tokens": model_limit(model), "takes_effort": takes_effort(model)}

    @app.get("/ui", include_in_schema=False)
    def root() -> RedirectResponse:
        return RedirectResponse(url="/ui/")

    if static_dir is not None and static_dir.is_dir():
        # Not `app.frontend()`: its routes are low priority, so the Agent Server's own `/ui`
        # mount (langgraph_api/api/ui.py) answers first and the UI never loads.
        app.mount("/ui", StaticFiles(directory=static_dir, html=True), name="ui")
    else:

        @app.get("/ui/", include_in_schema=False)
        def missing() -> JSONResponse:
            return JSONResponse(
                {"detail": "UI not built; run `mise run build` or use `vp dev`."}, status_code=404
            )

    return app


app = create_app()
