"""The run's settings, from assistant `context` (Studio, SDK) and `config["configurable"]`.

A source without a `version` is read as the current one: Studio saves an assistant without one.
That holds only while each version just adds keys; a version that renames or removes one must
decide how to read these.
"""

from collections.abc import Mapping
from typing import Any

from langchain_core.runnables import RunnableConfig
from pydantic import BaseModel

from langchain_chess_systemone.settings import VERSION, ChessContext, migrate, resolve


def _context_values(runtime: Any) -> dict[str, Any]:
    execution = getattr(runtime, "execution_runtime", None)
    context = getattr(execution, "context", None)
    if context is None:
        return {}
    if isinstance(context, BaseModel):
        return context.model_dump()
    return dict(context)


def _source(values: Mapping[str, Any]) -> dict[str, Any]:
    """One source's settings in the current version; the server's own keys are dropped."""
    if values.get("version") is None:
        values = {**values, "version": VERSION}
    return migrate(values, unknown="drop")


def resolve_context(config: RunnableConfig | None = None, runtime: Any = None) -> ChessContext:
    """Assistant context first, then the keys present in `configurable`.

    An explicit null resets a setting to its default (so a run can clear an assistant's
    `top_p`); an omitted key keeps the assistant's value. Values are validated after merging,
    so a bad one fails the run up front.
    """
    configurable = (config or {}).get("configurable") or {}
    return resolve(_source(_context_values(runtime)), _source(configurable))
