"""The settings a CLI adapter plays with, and how its runs are traced."""

from collections.abc import Mapping
from typing import Any, Literal

from langchain_core.runnables import RunnableConfig

from langchain_chess_systemone.agent import sent
from langchain_chess_systemone.settings import ChessContext, dump

type Surface = Literal["tui", "uci"]


def overlay(settings: ChessContext, flags: Mapping[str, Any]) -> ChessContext:
    """`settings` with the flags that were given; a flag left out is None."""
    given = {k: v for k, v in flags.items() if v is not None}
    return ChessContext.model_validate({**dump(settings), **given})


def run_config(surface: Surface, thread_id: str, settings: ChessContext) -> RunnableConfig:
    """Names and tags the trace by surface; the settings go in metadata, as on server traces,
    with the values sent where `model_kwargs` changed them."""
    return {
        "configurable": {"thread_id": thread_id},
        "run_name": f"chess-{surface}",
        "tags": [surface],
        "metadata": {"surface": surface, **dump(settings), **sent(settings)},
    }
