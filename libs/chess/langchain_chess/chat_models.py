"""Chat models from `init_chat_model` specs, sized for a chess agent.

Credentials are the provider's own environment, or langchain-core's gateway resolution.
"""

from collections.abc import Mapping
from typing import Any

from langchain.chat_models import init_chat_model
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.language_models.model_profile import ModelProfile

from langchain_chess.efforts import takes_effort
from langchain_chess.errors import EFFORT_ADVICE
from langchain_chess.model_arguments import ModelArguments, ModelArgumentsError
from langchain_chess.models import GATEWAY_PREFIX, model_identity
from langchain_chess.pricing import context_window

MAX_TOKENS = 64000
"""The output cap, reasoning included (8000 ran out mid-game at medium effort), and the budget of
a gateway model whose own limit is unknown. Every web preset accepts it: Claude Haiku 4.5, the
only one that enforces its limit, allows exactly 64000 (probed 2026-09-26)."""


def output_budget(window: int | None, ceiling: int | None = None) -> int:
    """MAX_TOKENS, capped by the model's own output limit and by half of a smaller window."""
    return min([MAX_TOKENS, *(cap for cap in (window and window // 2, ceiling) if cap)])


def chat_model(
    model: str,
    arguments: ModelArguments | None = None,
    *,
    connection: Mapping[str, Any] | None = None,
) -> BaseChatModel:
    """`connection` is trusted code's own, such as an HTTP client in tests; never settings'."""
    arguments = arguments or ModelArguments()
    connection = connection or {}
    _check_effort(model, arguments.reasoning_effort)
    window = context_window(model)
    _check_room(model, window, arguments.max_tokens)
    budget = arguments.max_tokens or output_budget(window)
    if model.startswith(GATEWAY_PREFIX):
        ceiling = (_vendor_profile(model) or {}).get("max_output_tokens")
        budget = arguments.max_tokens or output_budget(window, ceiling)
        # The gateway's ChatOpenAI has no profile, and memory's fractional trigger needs one.
        profile = ModelProfile(max_input_tokens=window - budget) if window else None
        return _build(model, budget, arguments, profile, connection)
    native: ModelProfile = _build(model, budget, arguments, None, connection).profile or {}
    # Only a native profile knows the output limit, and for a bare spec (`gpt-4`) the window.
    window = window or native.get("max_input_tokens")
    _check_room(model, window, arguments.max_tokens)
    budget = arguments.max_tokens or output_budget(window, native.get("max_output_tokens"))
    # Memory schedules against the input limit, which must leave room for the output budget.
    if limits := [n for n in (native.get("max_input_tokens"), window and window - budget) if n]:
        native = {**native, "max_input_tokens": min(limits)}
    return _build(model, budget, arguments, native, connection)


def _check_room(model: str, window: int | None, max_tokens: int | None) -> None:
    """An output limit that fills the window leaves no input, and memory would summarize always."""
    if window and max_tokens is not None and max_tokens >= window:
        msg = f"an output limit of {max_tokens} leaves no room in {model}'s {window}-token window"
        raise ModelArgumentsError(msg)


def _check_effort(model: str, effort: str | None) -> None:
    """Fails before the first call, where the provider would answer the effort with a 400."""
    if effort is not None and not takes_effort(model):
        msg = f"{model} doesn't take a reasoning effort; {EFFORT_ADVICE}"
        raise ModelArgumentsError(msg)


def _vendor_profile(model: str) -> ModelProfile | None:
    """The vendor's own profile for a gateway model, when its integration is installed."""
    # TODO: pydantic/genai-prices#700 adds output limits per model. Once it ships, read the limit
    # from genai-prices (which already supplies the window) and drop this lookup.
    vendor, name = model_identity(model)
    try:
        # Construction makes no request; the key only satisfies the integration's validation.
        return init_chat_model(f"{vendor}:{name}", api_key="unused").profile
    except (ImportError, ValueError):
        return None


def _build(
    model: str,
    max_tokens: int,
    arguments: ModelArguments,
    profile: ModelProfile | None,
    connection: Mapping[str, Any],
) -> BaseChatModel:
    # Models without reasoning reject the parameter outright, even as a default: an effort is
    # in `arguments` only when one was set.
    kwargs: dict[str, Any] = {
        "max_tokens": max_tokens,
        # The trace span's name; through the gateway every vendor would read as `ChatOpenAI`.
        "name": model_identity(model)[1],
        **({"profile": profile} if profile is not None else {}),
        **arguments.kwargs,
        **connection,
    }
    return init_chat_model(model, **kwargs)
