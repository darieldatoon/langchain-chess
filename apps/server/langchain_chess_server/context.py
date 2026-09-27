"""The run's settings, from assistant `context` (Studio, SDK) and `config["configurable"]`.

A source without a `version` is read as version 1: Studio saves an assistant without one. The
Agent Server merges an assistant's context with the run's before the graph sees it, so an
assistant saved before versions can arrive under a run's `version`. Its older forms can't be
mistaken for a later version's, so they are converted whatever the version says.
"""

from collections.abc import Mapping
from typing import Any

from langchain_core.runnables import RunnableConfig
from pydantic import BaseModel

from langchain_chess_systemone.settings import ChessContext, from_legacy, migrate, resolve


def _context_values(runtime: Any) -> dict[str, Any]:
    execution = getattr(runtime, "execution_runtime", None)
    context = getattr(execution, "context", None)
    if context is None:
        return {}
    if isinstance(context, BaseModel):
        return context.model_dump()
    return dict(context)


def _older_forms(values: Mapping[str, Any]) -> dict[str, Any]:
    """An older assistant's keys, merged in under a run's version, in the current form."""
    older = {k: values[k] for k in ("memory", "show_legal_moves") if k in values}
    if older.get("memory") not in ("none", "summarize"):
        older.pop("memory", None)
    if "move_list" in values:
        older.pop("show_legal_moves", None)
    rest = {k: v for k, v in values.items() if k != "show_legal_moves"}
    return {**rest, **from_legacy(older)}


def _source(values: Mapping[str, Any]) -> dict[str, Any]:
    """One source's settings in the current version; the server's own keys are dropped."""
    current = _older_forms(values)
    if current.get("version") is None:
        current = {**current, "version": 1}
    return migrate(current, unknown="drop")


def resolve_context(config: RunnableConfig | None = None, runtime: Any = None) -> ChessContext:
    """Assistant context first, then the keys present in `configurable`.

    An explicit null resets a setting to its default (so a run can clear an assistant's
    `top_p`); an omitted key keeps the assistant's value. Values are validated after merging,
    so a bad one fails the run up front.
    """
    configurable = (config or {}).get("configurable") or {}
    return resolve(_source(_context_values(runtime)), _source(configurable))
