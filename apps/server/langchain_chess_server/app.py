"""The web UI's one route next to the graph API: what the server knows about a model.

GitHub Pages hosts the UI itself. Custom routes shadow the Agent Server's own, so name new ones
clear of its API (`/threads`, `/runs`, `/assistants`, `/store`, `/ui`, `/ok`, ...).
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI

from langchain_chess.efforts import takes_effort
from langchain_chess_server.clients import DECISIONS_POOL, POOL
from langchain_chess_server.graph import model_limit


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """The Agent Server merges this app's lifespan with its own, so graph clients close too."""
    try:
        yield
    finally:
        await POOL.aclose()
        await DECISIONS_POOL.aclose()


def create_app() -> FastAPI:
    app = FastAPI(
        title="langchain-chess",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )

    @app.get("/model-facts")
    def model_facts(model: str) -> dict[str, Any]:
        """What the new-game dialog offers: memory for a known input limit, and a reasoning
        effort unless the model is known to take none."""
        return {"max_input_tokens": model_limit(model), "takes_effort": takes_effort(model)}

    return app


app = create_app()
