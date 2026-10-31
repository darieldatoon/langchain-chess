from datetime import UTC, datetime

import pytest

from langchain_chess.pricing import (
    PRICED_WITH,
    Tokens,
    context_window,
    decisions_price,
    make_call,
    price,
    tokens_from_usage,
    turn_cost,
)
from langchain_chess.testing import usage

AT = datetime(2026, 9, 25, tzinfo=UTC)


def test_no_usage_is_unknown_not_free():
    tokens = tokens_from_usage(None)
    assert tokens.input is None
    call = make_call("llm", "anthropic:claude-opus-5", tokens, AT)
    assert call["cost_usd"] is None
    assert call["priced_with"] is None
    assert tokens_from_usage({}).output is None


def test_opus_through_the_responses_route():
    # The gateway's Responses translation: input includes cache reads and (5-minute) writes.
    tokens = tokens_from_usage(
        usage(1000, 100, input_token_details={"cache_read": 400, "cache_creation": 200})
    )
    assert (tokens.cache_read, tokens.cache_write, tokens.cache_write_1h) == (400, 200, None)
    call = make_call("llm", "anthropic/claude-opus-5", tokens, AT, provider="openai")
    assert call["model"] == "anthropic:claude-opus-5"
    # 400 uncached at $5/M, 400 read at $0.50/M, 200 written at $6.25/M, 100 out at $25/M.
    assert call["cost_usd"] == pytest.approx(0.002 + 0.0002 + 0.00125 + 0.0025)
    assert call["cost_complete"] is True
    assert call["priced_with"] == PRICED_WITH
    assert call["called_at"] == "2026-09-25T00:00:00+00:00"


def test_anthropic_one_hour_writes_use_total_plus_subset():
    details = {
        "cache_read": 0,
        "cache_creation": 0,
        "ephemeral_5m_input_tokens": 100,
        "ephemeral_1h_input_tokens": 300,
    }
    tokens = tokens_from_usage(usage(1000, 0, input_token_details=details))
    assert (tokens.cache_write, tokens.cache_write_1h) == (400, 300)
    cost, complete = price("anthropic", "claude-opus-5", tokens, AT)
    # 600 uncached at $5/M, 100 at the 5-minute $6.25/M, 300 at the 1-hour $10/M.
    assert cost == pytest.approx(0.003 + 0.000625 + 0.003)
    assert complete


def test_openai_decisions_is_priced_at_its_own_rate_not_the_chat_one():
    tokens = Tokens(input=2_000_000, output=0)
    decisions = make_call("systemone", "openai/gpt-6-luna", tokens, AT)
    chat = make_call("llm", "langsmith:openai/gpt-6-luna", tokens, AT)
    assert (decisions["model"], decisions["cost_usd"]) == ("openai:gpt-6-luna", pytest.approx(0.2))
    assert chat["cost_usd"] == pytest.approx(0.4)
    assert decisions_price("gpt-6-sol", tokens) == (None, False)
    assert decisions_price("gpt-6-luna", Tokens(input=None, output=None)) == (None, False)
    assert decisions_price("gpt-6-luna", Tokens(input=10, output=0, approximated=True))[1] is False


def test_jev_is_priced_under_typesafe_and_another_classifier_is_not():
    tokens = tokens_from_usage(usage(1000, 5))
    jev = make_call("systemone", "typesafe/jev-latest", tokens, AT)
    assert jev["model"] == "typesafe:jev-latest"
    assert jev["cost_usd"] == pytest.approx(0.000042)
    other = make_call("systemone", "other-ranker", tokens, AT, provider="typesafe")
    assert other["cost_usd"] is None


@pytest.mark.parametrize(
    ("model", "window"),
    [
        ("langsmith:anthropic/claude-opus-5-5", 1_000_000),
        ("langsmith:openai/gpt-5.6-sol", 1_050_000),
        ("langsmith:fireworks/accounts/fireworks/models/kimi-k3", 1_040_000),
        ("langsmith:baseten/zai-org/GLM-5.3", 1_048_000),
        ("langsmith:fireworks/accounts/fireworks/models/nonexistent", None),
        ("unknown-model", None),
    ],
)
def test_context_windows_come_from_the_price_snapshot(model, window):
    assert context_window(model) == window


def test_unknown_model_and_service_tier_keys():
    assert price("anthropic", "claude-nonexistent", tokens_from_usage(usage()), AT) == (None, False)
    tokens = tokens_from_usage(
        usage(1000, 100, input_token_details={"priority_cache_read": 50, "audio": 0})
    )
    assert tokens.approximated
    cost, complete = price("anthropic", "claude-opus-5", tokens, AT)
    assert cost == pytest.approx(0.005 + 0.0025)
    assert not complete
    out = tokens_from_usage(usage(10, 10, output_token_details={"reasoning": 4, "audio": 3}))
    assert out.reasoning == 4
    assert out.approximated


def _call(cost, complete=True):
    return {"cost_usd": cost, "cost_complete": complete}


def test_turn_cost():
    assert turn_cost([]) is None
    assert turn_cost([_call(None)]) is None
    assert turn_cost([_call(0.5), _call(0.25)]) == {"usd": 0.75, "complete": True}
    assert turn_cost([_call(0.5), _call(None)]) == {"usd": 0.5, "complete": False}
    assert turn_cost([_call(0.5, complete=False)]) == {"usd": 0.5, "complete": False}
