"""The settings a CLI adapter plays with, and how its runs are traced."""

from collections.abc import Mapping, Sequence
from typing import Any, Literal

from langchain_core.runnables import RunnableConfig

from langchain_chess_systemone.agent import sent
from langchain_chess_systemone.settings import ChessContext, SettingsError, dump

type Surface = Literal["tui", "uci"]


def overlay(
    settings: ChessContext, flags: Mapping[str, Any], resets: Sequence[str] = ()
) -> ChessContext:
    """`settings` with `resets` back at their defaults, then the flags that were given; a flag
    left out is None."""
    defaults = dump(ChessContext())
    if unknown := [key for key in resets if key not in defaults or key == "version"]:
        msg = f"no such setting to reset: {', '.join(unknown)}"
        raise SettingsError(msg)
    given = {k: v for k, v in flags.items() if v is not None}
    reset = {key: defaults[key] for key in resets}
    return ChessContext.model_validate({**dump(settings), **reset, **given})


def run_config(surface: Surface, thread_id: str, settings: ChessContext) -> RunnableConfig:
    """Names and tags the trace by surface; the settings go in metadata, as on server traces,
    with the values sent where `model_kwargs` changed them."""
    return {
        "configurable": {"thread_id": thread_id},
        "run_name": f"chess-{surface}",
        "tags": [surface],
        "metadata": {"surface": surface, **dump(settings), **sent(settings)},
    }
