from typing import Any, cast

import chess
import pytest

from jev_chess.policies import (
    Candidate,
    GateSignal,
    HybridConfig,
    HybridPolicy,
    JevConfig,
    JevPolicy,
    JevRanking,
    LLMConfig,
    LLMPolicy,
    gate_value,
    shortlist,
)
from jev_chess.policies import hybrid as hybrid_module
from tests.fake_jev import FakeClassifier, choice_response
from tests.fake_llm import FakeChatModel, reply

ITALIAN = "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"
SURE = {"e1g1": 0.9, "b1c3": 0.05, "d2d4": 0.03, "c4b5": 0.02}
UNSURE = {"e1g1": 0.35, "b1c3": 0.3, "d2d4": 0.2, "c4b5": 0.1, "f3g5": 0.05}


def ranking(probs: dict[str, float], confidence: float = 0.5) -> JevRanking:
    ordered = sorted(probs.items(), key=lambda kv: -kv[1])
    return JevRanking(
        tuple(Candidate(u, p) for u, p in ordered), confidence, "jev-1.13.0", 1500, 300, 200.0
    )


def policy(
    jev_probs: dict[str, float],
    llm_replies: list[str],
    jev_confidence: float = 0.5,
    threshold: float = 0.9,
    k: int = 5,
    gate: GateSignal = "margin",
) -> tuple[HybridPolicy, FakeClassifier, FakeChatModel]:
    fake_jev = FakeClassifier(
        scripted=choice_response(jev_probs, jev_confidence, model="jev-1.13.0", input_tokens=1500)
    )
    fake_llm = FakeChatModel([reply(text, 400, 200, 150) for text in llm_replies])
    config = HybridConfig(
        llm=LLMConfig(model="langsmith:anthropic/claude-opus-5"),
        threshold=threshold,
        k=k,
        gate=gate,
    )
    return (
        HybridPolicy(JevPolicy(fake_jev, JevConfig()), LLMPolicy(fake_llm, config.llm), config),
        fake_jev,
        fake_llm,
    )


# --- config and helpers -------------------------------------------------------------------


def test_config_validation_and_label() -> None:
    assert HybridConfig().label == "hybrid:langsmith:anthropic/claude-opus-5:medium:k5:t0.9:margin"
    assert HybridConfig(top_p=0.8, threshold=0.0).label.endswith(":p0.8:t0:margin")
    with pytest.raises(ValueError, match="k must be"):
        HybridConfig(k=0)
    with pytest.raises(ValueError, match="k must be"):
        HybridConfig(k=256)
    with pytest.raises(ValueError, match="threshold"):
        HybridConfig(threshold=1.5)
    with pytest.raises(ValueError, match="top_p"):
        HybridConfig(top_p=0.0)


def test_gate_value_and_shortlist() -> None:
    r = ranking(UNSURE, confidence=0.42)
    assert gate_value(r, "margin") == pytest.approx(0.05)
    assert gate_value(r, "confidence") == 0.42
    assert [c.uci for c in shortlist(r, HybridConfig(k=3))] == ["e1g1", "b1c3", "d2d4"]
    assert [c.uci for c in shortlist(r, HybridConfig(k=5, top_p=0.6))] == ["e1g1", "b1c3"]
    assert [c.uci for c in shortlist(r, HybridConfig(k=5, top_p=0.64))] == ["e1g1", "b1c3"]
    assert [c.uci for c in shortlist(r, HybridConfig(k=5, top_p=0.66))] == ["e1g1", "b1c3", "d2d4"]
    assert len(shortlist(r, HybridConfig(k=2, top_p=0.99))) == 2


# --- graph --------------------------------------------------------------------------------


def test_gate_holds_plays_jev_without_calling_llm() -> None:
    hybrid, _, fake_llm = policy(SURE, ["MOVE: Nc3"], threshold=0.8)
    decision = hybrid.decide(chess.Board(ITALIAN))
    assert decision.uci == "e1g1"
    assert decision.source == "jev"
    assert decision.escalated is False
    assert decision.jev_top_uci == "e1g1"
    assert decision.jev_margin == pytest.approx(0.85)
    assert decision.model == "jev-1.13.0"
    assert decision.cost_usd == pytest.approx(1500 * 0.042 / 1_000_000)
    assert decision.latency_ms >= 0
    assert fake_llm.calls == []


def test_gate_fails_escalates_to_llm_over_shortlist() -> None:
    hybrid, _, fake_llm = policy(UNSURE, ["I prefer development.\nMOVE: Nc3"], threshold=0.9, k=3)
    decision = hybrid.decide(chess.Board(ITALIAN))
    assert decision.uci == "b1c3"
    assert decision.source == "llm"
    assert decision.escalated is True
    assert decision.jev_top_uci == "e1g1"
    assert decision.jev_top_k is not None
    assert [c.uci for c in decision.jev_top_k] == ["e1g1", "b1c3", "d2d4"]
    assert decision.model == "claude-opus-5"
    assert decision.input_tokens == 1500 + 400
    assert decision.output_tokens == 10 + 200
    assert decision.reasoning_tokens == 150
    assert decision.cost_usd == pytest.approx(1500 * 0.042 / 1e6 + (400 * 5 + 200 * 25) / 1e6)
    prompt = str(fake_llm.calls[0][1].content)
    assert "candidate moves: O-O, Nc3, d4" in prompt
    assert "Legal moves" not in prompt


def test_llm_exhausts_retries_falls_back_to_jev_top() -> None:
    hybrid, _, fake_llm = policy(UNSURE, ["MOVE: Qxf7"], threshold=0.9, k=3)
    decision = hybrid.decide(chess.Board(ITALIAN))
    assert decision.source == "fallback_jev"
    assert decision.uci == "e1g1"
    assert decision.escalated is True
    assert decision.illegal_attempts == 4
    assert len(fake_llm.calls) == 4


def test_threshold_zero_is_jev_only_and_one_is_pure_pruner() -> None:
    jev_only, _, llm_a = policy(UNSURE, ["MOVE: Nc3"], threshold=0.0)
    assert jev_only.decide(chess.Board(ITALIAN)).source == "jev"
    assert llm_a.calls == []
    pruner, _, llm_b = policy(SURE, ["MOVE: Nc3"], threshold=1.0)
    assert pruner.decide(chess.Board(ITALIAN)).source == "llm"
    assert len(llm_b.calls) == 1


def test_confidence_gate() -> None:
    hybrid, _, fake_llm = policy(
        UNSURE, ["MOVE: Nc3"], jev_confidence=0.95, gate="confidence", threshold=0.9
    )
    assert hybrid.decide(chess.Board(ITALIAN)).source == "jev"
    assert fake_llm.calls == []


async def test_async_path_escalates() -> None:
    hybrid, _, _ = policy(UNSURE, ["MOVE: d4"], threshold=0.9)
    decision = await hybrid.adecide(chess.Board(ITALIAN))
    assert decision.uci == "d2d4"
    assert decision.source == "llm"


def test_unknown_llm_price_propagates_none_cost() -> None:
    fake_jev = FakeClassifier(scripted=choice_response(UNSURE, 0.4, model="jev-1.13.0"))
    fake_llm = FakeChatModel([reply("MOVE: Nc3")])
    config = HybridConfig(llm=LLMConfig(model="openai:mystery"), threshold=0.9)
    hybrid = HybridPolicy(JevPolicy(fake_jev), LLMPolicy(fake_llm, config.llm), config)
    assert hybrid.decide(chess.Board(ITALIAN)).cost_usd is None


def test_from_settings_wires_both_policies(monkeypatch: pytest.MonkeyPatch) -> None:
    built: list[str] = []
    monkeypatch.setattr(
        hybrid_module.JevPolicy,
        "from_settings",
        classmethod(
            lambda cls, settings=None, config=None: (
                built.append("jev"),
                JevPolicy(FakeClassifier(), config),
            )[1]
        ),
    )
    monkeypatch.setattr(
        hybrid_module.LLMPolicy,
        "from_settings",
        classmethod(
            lambda cls, settings=None, config=None: (
                built.append("llm"),
                LLMPolicy(FakeChatModel([reply("MOVE: a3")]), config),
            )[1]
        ),
    )
    hybrid = HybridPolicy.from_settings(None, HybridConfig(threshold=1.0))
    assert built == ["jev", "llm"]
    assert hybrid.decide(chess.Board()).source == "llm"


def test_explicit_history_reaches_jev_and_the_llm() -> None:
    hybrid, fake_jev, fake_llm = policy(UNSURE, ["MOVE: Nc3"], threshold=1.0)
    board = chess.Board(ITALIAN)  # no move stack: the FEN-only case the game graph hits
    hybrid.decide(board, history=["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6"])
    state = cast("dict[str, Any]", fake_jev.requests[0]["state"])
    assert state["recent_moves_san"] == ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6"]
    assert "Moves so far: 1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6" in str(fake_llm.calls[0][1].content)


async def test_explicit_history_async() -> None:
    hybrid, fake_jev, _ = policy(UNSURE, ["MOVE: Nc3"], threshold=1.0)
    await hybrid.adecide(chess.Board(ITALIAN), history=["e4", "e5"])
    state = cast("dict[str, Any]", fake_jev.requests[0]["state"])
    assert state["recent_moves_san"] == ["e4", "e5"]
