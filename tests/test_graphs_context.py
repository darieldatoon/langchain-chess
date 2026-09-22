from dataclasses import dataclass
from typing import Any

import pytest
from pydantic import ValidationError

from jev_chess.graphs import (
    HybridContext,
    JevKnobs,
    LLMKnobs,
    PlayContext,
    hybrid_config,
    jev_config,
    llm_config,
    player_spec,
    resolve_context,
)
from jev_chess.runner.players import HybridSpec, JevSpec, LLMSpec, RandomSpec


@dataclass
class FakeExecution:
    context: Any


@dataclass
class FakeRuntime:
    execution_runtime: FakeExecution | None


def test_defaults_match_the_pilot_hybrid() -> None:
    ctx = PlayContext()
    assert ctx.policy == "hybrid"
    assert player_spec(ctx).name == "hybrid:langsmith:anthropic/claude-opus-5:medium:k5:t0.9:margin"
    cfg = hybrid_config(ctx)
    assert (cfg.k, cfg.threshold, cfg.gate) == (5, 0.9, "margin")
    assert cfg.llm.model == "langsmith:anthropic/claude-opus-5"
    assert (cfg.jev.style, cfg.jev.with_eval) == ("rich", False)


def test_player_specs_for_every_policy() -> None:
    assert player_spec(PlayContext(policy="random")) == RandomSpec()
    assert player_spec(PlayContext(policy="jev", style="terse")) == JevSpec(style="terse")
    assert player_spec(
        PlayContext(policy="llm", model="openai:gpt-5.6-sol", reasoning_effort="low")
    ) == LLMSpec(model="openai:gpt-5.6-sol", reasoning_effort="low")
    spec = player_spec(PlayContext(policy="hybrid", top_p=0.8, threshold=0.5, gate="confidence"))
    assert isinstance(spec, HybridSpec)
    assert (spec.top_p, spec.threshold, spec.gate) == (0.8, 0.5, "confidence")


def test_config_builders() -> None:
    jev = jev_config(JevKnobs(jev_model="jev-1.13.0", with_nouls=True))
    assert (jev.model, jev.with_nouls) == ("jev-1.13.0", True)
    llm = llm_config(LLMKnobs(model="gpt-5.6-sol", include_legal_moves=False))
    assert (llm.model, llm.include_legal_moves) == ("langsmith:openai/gpt-5.6-sol", False)
    assert llm_config(LLMKnobs(), include_legal_moves=False).include_legal_moves is False


def test_resolve_merges_context_then_configurable() -> None:
    runtime = FakeRuntime(FakeExecution({"threshold": 0.3, "k": 3, "unknown": 1}))
    config: Any = {"configurable": {"k": 7, "thread_id": "t1", "top_p": None, "policy": "llm"}}
    ctx = resolve_context(PlayContext, config, runtime)
    assert ctx.threshold == 0.3
    assert ctx.k == 7
    assert ctx.policy == "llm"
    assert ctx.top_p is None


def test_resolve_accepts_dataclass_context_and_missing_runtime() -> None:
    runtime = FakeRuntime(FakeExecution(HybridContext(threshold=0.1)))
    assert resolve_context(HybridContext, None, runtime).threshold == 0.1
    assert resolve_context(HybridContext, None, FakeRuntime(None)).threshold == 0.9
    assert resolve_context(PlayContext).policy == "hybrid"


def test_resolve_validates_literals() -> None:
    with pytest.raises(ValidationError):
        resolve_context(PlayContext, {"configurable": {"policy": "stockfish"}})
