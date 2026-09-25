"""Pricing calls with genai-prices' bundled snapshot. Pure.

No gateway route returns a cost (the gateway prices calls asynchronously for its own spend
caps), so cost is computed here from `usage_metadata`. Never call `update_prices`: prices change
only when the pinned package is bumped.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, TypedDict

import genai_prices
from genai_prices import Usage, calc_price

from langchain_chess.models import model_identity
from langchain_chess.state import Call, CallKind

PRICED_WITH = f"genai-prices {genai_prices.__version__}"

# `input_token_details` keys with an exact genai-prices mapping. Anything else (for example the
# service-tier-prefixed `priority_cache_read`) is already inside `input_tokens`, so it is priced
# as ordinary input and the cost is marked incomplete.
_INPUT_DETAILS = frozenset(
    {"cache_read", "cache_creation", "ephemeral_5m_input_tokens", "ephemeral_1h_input_tokens"}
)
_OUTPUT_DETAILS = frozenset({"reasoning"})


@dataclass(frozen=True, slots=True)
class Tokens:
    """Usage in genai-prices' convention: `input` already includes cache reads and writes, and
    `cache_write_1h` is a subset of `cache_write`."""

    input: int | None
    output: int | None
    reasoning: int = 0
    cache_read: int | None = None
    cache_write: int | None = None
    cache_write_1h: int | None = None
    approximated: bool = False


class TurnCost(TypedDict):
    usd: float
    complete: bool
    """False if any call is unpriced or approximated: the total is then an estimate."""


def _int(value: Any) -> int:
    return int(value or 0)


def tokens_from_usage(usage: Mapping[str, Any] | None) -> Tokens:
    """Read LangChain `usage_metadata`. No usage at all is unknown, never zero."""
    if not usage:
        return Tokens(input=None, output=None)
    inputs: Mapping[str, Any] = usage.get("input_token_details") or {}
    outputs: Mapping[str, Any] = usage.get("output_token_details") or {}
    if "ephemeral_5m_input_tokens" in inputs or "ephemeral_1h_input_tokens" in inputs:
        # ChatAnthropic reports TTL-split writes and zeroes the generic `cache_creation`.
        one_hour = _int(inputs.get("ephemeral_1h_input_tokens"))
        cache_write: int | None = _int(inputs.get("ephemeral_5m_input_tokens")) + one_hour
        cache_write_1h: int | None = one_hour
    else:
        # The gateway's Responses route writes 5-minute entries only.
        cache_write = _int(inputs["cache_creation"]) if "cache_creation" in inputs else None
        cache_write_1h = None
    approximated = any(_int(v) for k, v in inputs.items() if k not in _INPUT_DETAILS) or any(
        _int(v) for k, v in outputs.items() if k not in _OUTPUT_DETAILS
    )
    return Tokens(
        input=_int(usage.get("input_tokens")),
        output=_int(usage.get("output_tokens")),
        reasoning=_int(outputs.get("reasoning")),
        cache_read=_int(inputs["cache_read"]) if "cache_read" in inputs else None,
        cache_write=cache_write,
        cache_write_1h=cache_write_1h,
        approximated=approximated,
    )


def price(provider: str, model: str, tokens: Tokens, at: datetime) -> tuple[float | None, bool]:
    """(cost in USD, complete). None for unreported usage or a model genai-prices doesn't know."""
    if tokens.input is None and tokens.output is None:
        return None, False
    usage = Usage(
        input_tokens=tokens.input,
        output_tokens=tokens.output,
        cache_read_tokens=tokens.cache_read or None,
        cache_write_tokens=tokens.cache_write or None,
        cache_write_1h_tokens=tokens.cache_write_1h or None,
    )
    try:
        result = calc_price(usage, model, provider_id=provider, genai_request_timestamp=at)
    except LookupError:
        return None, False
    return float(result.total_price), not tokens.approximated


def make_call(
    kind: CallKind, model: str, tokens: Tokens, at: datetime, provider: str | None = None
) -> Call:
    """A priced `Call`. `model` may be a spec, a gateway name or a bare name with `provider`."""
    vendor, name = model_identity(model, provider)
    cost, complete = price(vendor, name, tokens, at)
    return Call(
        kind=kind,
        model=f"{vendor}:{name}",
        input_tokens=tokens.input,
        output_tokens=tokens.output,
        reasoning_tokens=tokens.reasoning,
        cache_read_tokens=tokens.cache_read,
        cache_write_tokens=tokens.cache_write,
        cache_write_1h_tokens=tokens.cache_write_1h,
        called_at=at.isoformat(),
        cost_usd=cost,
        cost_complete=complete,
        priced_with=PRICED_WITH if cost is not None else None,
    )


def turn_cost(calls: Sequence[Call]) -> TurnCost | None:
    """A move's cost is its turn's total: every LLM attempt, System 1 request and summary."""
    priced = [c["cost_usd"] for c in calls if c["cost_usd"] is not None]
    if not priced:
        return None
    complete = all(c["cost_usd"] is not None and c["cost_complete"] for c in calls)
    return TurnCost(usd=sum(priced), complete=complete)
