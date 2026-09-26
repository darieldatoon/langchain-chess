"""Chat models from `init_chat_model` specs, sized for a chess agent.

Credentials are the provider's own environment, or langchain-core's gateway resolution.
"""

from typing import Any

from langchain.chat_models import init_chat_model
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.language_models.model_profile import ModelProfile

from langchain_chess.models import GATEWAY_PREFIX, model_identity
from langchain_chess.pricing import context_window

MAX_TOKENS = 64000
"""The output cap, reasoning included (8000 ran out mid-game at medium effort), and the budget of
a gateway model whose own limit is unknown. Every web preset accepts it: Claude Haiku 4.5, the
only one that enforces its limit, allows exactly 64000 (probed 2026-09-26)."""


def output_budget(window: int | None, ceiling: int | None = None) -> int:
    """MAX_TOKENS, capped by the model's own output limit and by half of a smaller window."""
    return min([MAX_TOKENS, *(cap for cap in (window and window // 2, ceiling) if cap)])


def chat_model(model: str, reasoning_effort: str | None = None) -> BaseChatModel:
    window = context_window(model)
    budget = output_budget(window)
    if model.startswith(GATEWAY_PREFIX):
        budget = output_budget(window, (_vendor_profile(model) or {}).get("max_output_tokens"))
        # The gateway's ChatOpenAI has no profile, and summarize's fractional trigger needs one.
        profile = ModelProfile(max_input_tokens=window - budget) if window else None
        return _build(model, budget, reasoning_effort, profile)
    native: ModelProfile = _build(model, budget, reasoning_effort, None).profile or {}
    # Only a native profile knows the output limit, and for a bare spec (`gpt-4`) the window.
    window = window or native.get("max_input_tokens")
    budget = output_budget(window, native.get("max_output_tokens"))
    # Summarize schedules against the input limit, which must leave room for the output budget.
    if limits := [n for n in (native.get("max_input_tokens"), window and window - budget) if n]:
        native = {**native, "max_input_tokens": min(limits)}
    return _build(model, budget, reasoning_effort, native)


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
    model: str, max_tokens: int, reasoning_effort: str | None, profile: ModelProfile | None
) -> BaseChatModel:
    kwargs: dict[str, Any] = {
        "max_tokens": max_tokens,
        # The trace span's name; through the gateway every vendor would read as `ChatOpenAI`.
        "name": model_identity(model)[1],
    }
    # Models without reasoning reject the parameter outright, even as a default.
    if reasoning_effort is not None:
        kwargs["reasoning_effort"] = reasoning_effort
    if profile is not None:
        kwargs["profile"] = profile
    return init_chat_model(model, **kwargs)
