"""`model_kwargs`: extra model constructor arguments, checked and resolved. Pure.

`model_kwargs` beats the settings, which beat the app's defaults. Names for the same thing are
reduced to one value first, or the integration would send both, or the app's value would win.
Some arguments are held back: on every surface, those that would redirect credentials, rename
the model or take over what the agent sends; on the server also those that reach tools and
resources the deployment's account owns, and anything off its allowlist.
"""

import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

type Surface = Literal["local", "server"]

EFFORT_NAMES = ("reasoning_effort", "reasoning.effort")
MAX_TOKENS_NAMES = ("max_tokens", "max_output_tokens", "max_completion_tokens")

CONNECTION_PATTERN = re.compile(
    r"key|secret|password|credential|token|header|proxy|endpoint|url|base|client|organization|project"
)
"""Credentials and connections: a redirected URL would carry the deployment's key."""
CONNECTION_EXEMPT = frozenset({*MAX_TOKENS_NAMES, "prompt_cache_key"})
MODEL_NAMES = frozenset({"model", "model_name", "model_id", "deployment_name", "azure_deployment"})
"""The app prices, sizes and names calls by the `model` setting."""
AGENT_OWNED = frozenset({"input", "messages", "instructions", "stream", "streaming", "background"})
"""`extra_body` is merged over the final request: `input` would replace the whole prompt."""
APP_OWNED = frozenset(
    {"model_kwargs", "model_provider", "configurable_fields", "config_prefix", "name", "profile"}
)
"""Constructor arguments that would nest past these checks, pick another integration, or
rename the trace and resize memory."""
ACCOUNT_RESOURCES = frozenset(
    {"tools", "tool_choice", "previous_response_id", "conversation", "prompt"}
)
"""Hosted tools, files, vector stores and conversations of the deployment's account."""
SERVER_ALLOWED = frozenset(
    {
        "temperature",
        "top_p",
        *MAX_TOKENS_NAMES,
        "reasoning_effort",
        "reasoning",
        "verbosity",
        "extra_body",
    }
)
"""Top-level arguments the server accepts: each reaches the gateway's Responses API request."""


class ModelArgumentsError(ValueError):
    """`model_kwargs` that can't be sent."""


@dataclass(frozen=True, slots=True)
class ModelArguments:
    """`model_kwargs` resolved: what goes to the model's constructor, and what it sends."""

    kwargs: Mapping[str, Any] = field(default_factory=dict)
    """Constructor arguments over the app's, with one name for each thing."""
    max_tokens: int | None = None
    """The output limit `model_kwargs` sets; None keeps the app's."""
    reasoning_effort: str | None = None
    """The effort the request carries, after `extra_body.reasoning` replaced the object."""


def held_back(name: str, *, surface: Surface, in_extra_body: bool = False) -> str | None:
    """Why `name` can't be set, or None."""
    if name in MODEL_NAMES:
        return "the model is the `model` setting"
    if name in AGENT_OWNED:
        return "the agent sends it"
    if not in_extra_body and name in APP_OWNED:
        return "the app sets it"
    # Inside `extra_body` too: a proxy may honor a body's own key or base URL.
    if name not in CONNECTION_EXEMPT and CONNECTION_PATTERN.search(name):
        return "credentials and connections come from the environment"
    if surface == "server" and name in ACCOUNT_RESOURCES:
        return "it reaches the deployment's own tools and resources"
    if surface == "server" and not in_extra_body and name not in SERVER_ALLOWED:
        return "the server doesn't send it"
    return None


def problems(model_kwargs: Mapping[str, Any], *, surface: Surface) -> list[str]:
    """Everything wrong with `model_kwargs` on a surface; empty when it can be sent."""
    found = [
        f"`{name}`: {why}"
        for name in model_kwargs
        if (why := held_back(name, surface=surface)) is not None
    ]
    extra_body = model_kwargs.get("extra_body")
    if extra_body is not None and not isinstance(extra_body, Mapping):
        found.append("`extra_body` must be an object")
    for name in extra_body if isinstance(extra_body, Mapping) else ():
        if (why := held_back(name, surface=surface, in_extra_body=True)) is not None:
            found.append(f"`extra_body.{name}`: {why}")
    reasoning = model_kwargs.get("reasoning")
    if reasoning is not None and not isinstance(reasoning, Mapping):
        found.append("`reasoning` must be an object")
    for names in (EFFORT_NAMES, MAX_TOKENS_NAMES):
        values = [v for name in names if (v := _get(model_kwargs, name)) is not None]
        # `True == 1` in Python, and JSON tells them apart.
        if any(type(v) is not type(values[0]) or v != values[0] for v in values):
            found.append(f"{', '.join(f'`{n}`' for n in names)} disagree: set one of them")
    effort = _one(model_kwargs, EFFORT_NAMES)
    if effort is not None and not (isinstance(effort, str) and effort):
        found.append("the reasoning effort must be a non-empty string")
    limit = _one(model_kwargs, MAX_TOKENS_NAMES)
    if limit is not None and not (_whole(limit) and limit >= 1):
        found.append("the output limit must be a positive integer")
    return found


def model_arguments(
    model_kwargs: Mapping[str, Any] | None,
    *,
    reasoning_effort: str | None = None,
    surface: Surface = "local",
) -> ModelArguments:
    """The constructor arguments for `model_kwargs` over the `reasoning_effort` setting."""
    given = {k: v for k, v in (model_kwargs or {}).items() if v is not None}
    if found := problems(given, surface=surface):
        msg = "model_kwargs can't be sent: " + "; ".join(found)
        raise ModelArgumentsError(msg)
    own = _one(given, EFFORT_NAMES)
    effort = own if own is not None else reasoning_effort
    kwargs = {k: v for k, v in given.items() if k not in (*MAX_TOKENS_NAMES, *EFFORT_NAMES)}
    if isinstance(reasoning := given.get("reasoning"), Mapping):
        rest = {k: v for k, v in reasoning.items() if k != "effort"}
        kwargs["reasoning"] = {**rest, "effort": effort} if effort is not None else rest
    elif effort is not None:
        kwargs["reasoning_effort"] = effort
    extra_body = given.get("extra_body") or {}
    sent = effort
    if "reasoning" in extra_body:
        replaced = extra_body["reasoning"]
        sent = replaced.get("effort") if isinstance(replaced, Mapping) else None
    return ModelArguments(
        kwargs=kwargs,
        max_tokens=int(limit) if (limit := _one(given, MAX_TOKENS_NAMES)) is not None else None,
        reasoning_effort=sent,
    )


def _whole(value: object) -> bool:
    """A browser reads 5.0 as 5, so this must too."""
    if isinstance(value, bool):
        return False
    return isinstance(value, int) or (isinstance(value, float) and value.is_integer())


def _get(model_kwargs: Mapping[str, Any], name: str) -> Any:
    head, _, tail = name.partition(".")
    value = model_kwargs.get(head)
    if not tail:
        return value
    return value.get(tail) if isinstance(value, Mapping) else None


def _one(model_kwargs: Mapping[str, Any], names: tuple[str, ...]) -> Any:
    """The value the aliases share; `problems` has rejected any that disagree."""
    return next((v for name in names if (v := _get(model_kwargs, name)) is not None), None)
