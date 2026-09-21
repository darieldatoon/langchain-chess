"""Per-token prices for cost accounting, USD per million tokens.

The gateway does not return cost in the response body (it lives on the LangSmith trace),
so the runner computes it locally from this table. Update the date when you refresh.
"""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Price:
    input_per_m: float
    output_per_m: float


# Verified 2026-09-21. Anthropic and TypeSafe list prices; OpenAI's gpt-5.6-sol is the
# promotional rate announced 2026-08-21 and guaranteed through at least 2026-11-21.
PRICES: dict[str, Price] = {
    "claude-opus-5": Price(input_per_m=5.00, output_per_m=25.00),
    "gpt-5.6-sol": Price(input_per_m=4.00, output_per_m=20.00),
    "jev-latest": Price(input_per_m=0.042, output_per_m=0.0),
    "jev-1.13.0": Price(input_per_m=0.042, output_per_m=0.0),
}


def cost_usd(model: str, input_tokens: int, output_tokens: int) -> float | None:
    """None when the model is not in the table, so unknown prices never masquerade as zero."""
    price = PRICES.get(model)
    if price is None:
        return None
    return (input_tokens * price.input_per_m + output_tokens * price.output_per_m) / 1_000_000
