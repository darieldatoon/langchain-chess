import chess
import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from jev_chess.policies import (
    LLMConfig,
    LLMPolicy,
    MoveDecision,
    build_prompt,
    cost_usd,
    legal_decision,
    make_chat_model,
    parse_move,
)
from jev_chess.policies import llm as llm_module
from jev_chess.settings import GatewaySettings
from tests.fake_llm import FakeChatModel, reply

ITALIAN = "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"


def italian_board() -> chess.Board:
    board = chess.Board()
    for uci in ("e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6"):
        board.push_uci(uci)
    return board


# --- prompt -------------------------------------------------------------------------------


def test_prompt_contains_pgn_fen_board_and_legal_moves() -> None:
    board = italian_board()
    text = build_prompt(board, [], LLMConfig(), None)
    assert "Moves so far: 1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6" in text
    assert f"FEN: {ITALIAN}" in text
    assert "White to move." in text
    assert "Legal moves: " in text
    assert "O-O" in text
    assert "MOVE: <move>" in text


def test_prompt_without_legal_moves_and_with_candidates() -> None:
    board = italian_board()
    bare = build_prompt(board, [], LLMConfig(include_legal_moves=False), None)
    assert "Legal moves" not in bare
    shortlist = build_prompt(board, [], LLMConfig(), ["e1g1", "b1c3"])
    assert "candidate moves: O-O, Nc3" in shortlist
    assert "Legal moves" not in shortlist


def test_prompt_first_move_and_check() -> None:
    assert "(none, this is the first move)" in build_prompt(chess.Board(), [], LLMConfig(), None)
    in_check = chess.Board("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3")
    assert "You are in check." in build_prompt(in_check, [], LLMConfig(), None)


# --- parsing ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "uci"),
    [
        ("I like development.\nMOVE: Nc3", "b1c3"),
        ("MOVE: **O-O**", "e1g1"),
        ("move: 0-0", "e1g1"),
        ("Final answer MOVE: e1g1", "e1g1"),
        ("MOVE: `Bxf7+`", "c4f7"),
        ("MOVE: Nxe5.", "f3e5"),
        ("I will play Nc3 here and castle later.", "b1c3"),
        ("Two ideas: d4 or Nc3. MOVE: d4", "d2d4"),
        ("First MOVE: Qh5 then MOVE: Nc3", "b1c3"),
    ],
)
def test_parse_move_accepts_common_formats(text: str, uci: str) -> None:
    move, rejection = parse_move(italian_board(), text)
    assert rejection is None
    assert move is not None
    assert move.uci() == uci


def test_parse_move_rejections() -> None:
    board = italian_board()
    assert parse_move(board, "I resign.") == (
        None,
        "no move found; end your reply with a line `MOVE: <move>`",
    )
    move, why = parse_move(board, "MOVE: Nxd5")
    assert move is None
    assert why is not None
    assert "not a legal move" in why


def test_promotion_parsing() -> None:
    board = chess.Board("8/P6k/8/8/8/8/8/K7 w - - 0 1")
    move, _ = parse_move(board, "MOVE: a8=Q")
    assert move is not None
    assert move.uci() == "a7a8q"


# --- graph --------------------------------------------------------------------------------


def test_policy_first_try_legal() -> None:
    fake = FakeChatModel([reply("Develop.\nMOVE: Nc3", 120, 60, 40)])
    decision = LLMPolicy(fake, LLMConfig(model="claude-opus-5")).decide(italian_board())
    assert decision.uci == "b1c3"
    assert decision.source == "llm"
    assert decision.illegal_attempts == 0
    assert (decision.input_tokens, decision.output_tokens, decision.reasoning_tokens) == (
        120,
        60,
        40,
    )
    assert decision.cost_usd == pytest.approx((120 * 5 + 60 * 25) / 1_000_000)
    assert decision.raw_reply == "Develop.\nMOVE: Nc3"
    assert isinstance(fake.calls[0][0], SystemMessage)
    assert isinstance(fake.calls[0][1], HumanMessage)


def test_policy_retries_with_feedback_then_succeeds() -> None:
    fake = FakeChatModel([reply("MOVE: Nxd5"), reply("MOVE: Qxd8"), reply("MOVE: O-O")])
    decision = LLMPolicy(fake, LLMConfig()).decide(italian_board())
    assert decision.uci == "e1g1"
    assert decision.source == "llm"
    assert decision.illegal_attempts == 2
    assert decision.input_tokens == 300
    feedback = fake.calls[1][-1]
    assert isinstance(feedback, HumanMessage)
    assert "rejected" in str(feedback.content)
    assert "Choose from:" in str(feedback.content)
    assert isinstance(fake.calls[1][-2], AIMessage)


def test_policy_falls_back_to_random_after_max_retries() -> None:
    fake = FakeChatModel([reply("MOVE: Nxd5")])
    policy = LLMPolicy(fake, LLMConfig(max_retries=2, seed=1))
    board = italian_board()
    decision = policy.decide(board)
    assert decision.source == "fallback_random"
    assert decision.illegal_attempts == 3
    assert chess.Move.from_uci(decision.uci) in board.legal_moves
    assert len(fake.calls) == 3


def test_policy_restricts_to_candidates() -> None:
    fake = FakeChatModel([reply("MOVE: Nc3"), reply("MOVE: O-O")])
    decision = LLMPolicy(fake, LLMConfig()).decide(italian_board(), candidates=["e1g1", "d2d4"])
    assert decision.uci == "e1g1"
    assert decision.illegal_attempts == 1
    assert "not one of the candidate moves" in str(fake.calls[1][-1].content)


def test_policy_fallback_stays_within_candidates() -> None:
    fake = FakeChatModel([reply("MOVE: Nc3")])
    decision = LLMPolicy(fake, LLMConfig(max_retries=0)).decide(
        italian_board(), candidates=["e1g1"]
    )
    assert decision.uci == "e1g1"
    assert decision.source == "fallback_random"


async def test_policy_async_path() -> None:
    fake = FakeChatModel([reply("MOVE: d4")])
    decision = await LLMPolicy(fake, LLMConfig()).adecide(italian_board())
    assert decision.uci == "d2d4"


def test_text_extraction_from_block_content() -> None:
    message = AIMessage(
        content=[
            {"type": "thinking", "thinking": "hmm"},
            {"type": "text", "text": "MOVE: d4"},
            "tail",
        ]
    )
    fake = FakeChatModel([message])
    decision = LLMPolicy(fake, LLMConfig()).decide(italian_board())
    assert decision.uci == "d2d4"
    assert decision.input_tokens == 0


def test_unknown_model_has_no_cost() -> None:
    assert cost_usd("mystery-model", 100, 100) is None
    fake = FakeChatModel([reply("MOVE: d4")])
    assert LLMPolicy(fake, LLMConfig(model="mystery")).decide(italian_board()).cost_usd is None


def test_legal_decision_rejects_illegal_uci() -> None:
    with pytest.raises(ValueError, match="not a legal move"):
        legal_decision({"e2e4"}, uci="e2e5", source="llm", model="m", latency_ms=0.0)
    assert isinstance(
        legal_decision({"e2e4"}, uci="e2e4", source="llm", model="m", latency_ms=0.0), MoveDecision
    )


def test_make_chat_model_gateway_and_direct(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: list[tuple[str, dict[str, object]]] = []

    def spy(model: str, **kwargs: object) -> FakeChatModel:
        captured.append((model, kwargs))
        return FakeChatModel([reply("MOVE: e4")])

    monkeypatch.setattr(llm_module, "init_chat_model", spy)
    settings = GatewaySettings(
        _env_file=None,
        LANGSMITH_GATEWAY=True,
        LANGSMITH_GATEWAY_API_KEY="lsv2_x",
        TYPESAFE_API_KEY="lsv2_x",
        TYPESAFE_BASE_URL="https://gateway.smith.langchain.com/typesafe",
    )
    make_chat_model(LLMConfig(reasoning_effort="low"), settings)
    make_chat_model(LLMConfig(model="openai:gpt-5.6-sol"))
    gateway_model, gateway_kwargs = captured[0]
    assert gateway_model == "langsmith:anthropic/claude-opus-5"
    assert gateway_kwargs["reasoning_effort"] == "low"
    assert gateway_kwargs["max_tokens"] == 32000
    assert gateway_kwargs["base_url"] == "https://gateway.smith.langchain.com/v1"
    assert str(gateway_kwargs["api_key"]) == "**********"
    direct_model, direct_kwargs = captured[1]
    assert direct_model == "openai:gpt-5.6-sol"
    assert "base_url" not in direct_kwargs
    assert "api_key" not in direct_kwargs
    policy = LLMPolicy.from_settings(settings, LLMConfig(model="langsmith:openai/gpt-5.6-sol"))
    assert policy.config.label == "langsmith:openai/gpt-5.6-sol:medium"
    assert policy.config.model_name == "gpt-5.6-sol"
    assert policy.config.via_gateway


def test_direct_spec_prices_by_bare_model_name() -> None:
    fake = FakeChatModel([reply("MOVE: e4", 100, 50)])
    decision = LLMPolicy(fake, LLMConfig(model="openai:gpt-5.6-sol")).decide(chess.Board())
    assert decision.model == "gpt-5.6-sol"
    assert decision.cost_usd == pytest.approx((100 * 4 + 50 * 20) / 1_000_000)


@pytest.mark.parametrize(
    ("text", "spec"),
    [
        ("claude-opus-5", "langsmith:anthropic/claude-opus-5"),
        ("gpt-5.6-sol", "langsmith:openai/gpt-5.6-sol"),
        ("o3-mini", "langsmith:openai/o3-mini"),
        ("openai:gpt-5.6-sol", "openai:gpt-5.6-sol"),
        ("anthropic:claude-opus-5", "anthropic:claude-opus-5"),
        ("langsmith:openai/gpt-5.6-sol", "langsmith:openai/gpt-5.6-sol"),
    ],
)
def test_resolve_model_spec(text: str, spec: str) -> None:
    from jev_chess.policies import bare_model_name, resolve_model_spec

    assert resolve_model_spec(text) == spec
    assert bare_model_name(spec) == text.split(":")[-1].split("/")[-1]


def test_resolve_model_spec_rejects_unknown_bare_name() -> None:
    from jev_chess.policies import resolve_model_spec

    with pytest.raises(ValueError, match="cannot infer a provider"):
        resolve_model_spec("mystery-9000")


def test_from_settings_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        llm_module, "init_chat_model", lambda model, **kwargs: FakeChatModel([reply("MOVE: e4")])
    )
    for k, v in {
        "LANGSMITH_GATEWAY": "true",
        "LANGSMITH_GATEWAY_API_KEY": "lsv2_x",
        "TYPESAFE_API_KEY": "lsv2_x",
        "TYPESAFE_BASE_URL": "https://gateway.smith.langchain.com/typesafe",
    }.items():
        monkeypatch.setenv(k, v)
    assert LLMPolicy.from_settings().decide(chess.Board()).uci == "e2e4"


@pytest.mark.live
def test_live_opus_plays_a_legal_move() -> None:
    decision = LLMPolicy.from_settings(config=LLMConfig(max_tokens=4000)).decide(italian_board())
    assert decision.source == "llm"
    assert decision.reasoning_tokens > 0
    assert decision.cost_usd is not None


def test_empty_reply_is_replaced_before_retry() -> None:
    from langchain_core.messages import AIMessage

    from jev_chess.policies.llm import EMPTY_REPLY

    fake = FakeChatModel([reply("", 100, 8000, 0), reply("MOVE: Nc3")])
    decision = LLMPolicy(fake, LLMConfig()).decide(italian_board())
    assert decision.uci == "b1c3"
    assert decision.illegal_attempts == 1
    replayed = fake.calls[1]
    assistant = [m for m in replayed if isinstance(m, AIMessage)]
    assert [m.content for m in assistant] == [EMPTY_REPLY]
    assert "no text" in str(replayed[-1].content)
    assert "Keep the reply short" in str(replayed[-1].content)
