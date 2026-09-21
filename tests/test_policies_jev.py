import chess
import pytest
from langchain_typesafe import Choice, Score

from jev_chess.policies import (
    Candidate,
    JevConfig,
    JevPolicy,
    JevRanking,
    build_request,
    build_state,
    history_san,
    parse_response,
)
from jev_chess.policies import jev as jev_module
from jev_chess.settings import GatewaySettings
from tests.fake_jev import FakeClassifier, choice_response

ITALIAN = "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"


def italian_board() -> chess.Board:
    board = chess.Board()
    for uci in ("e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6"):
        board.push_uci(uci)
    return board


def test_build_state_contains_facts_not_opinions() -> None:
    board = italian_board()
    state = build_state(board, history_san(board), JevConfig(history_plies=4))
    assert state["side_to_move"] == "white"
    assert state["fen"] == ITALIAN
    assert state["material"] == {"white": 39, "black": 39, "for_side_to_move": 0}
    assert state["recent_moves_san"] == ["Nf3", "Nc6", "Bc4", "Nf6"]
    assert state["in_check"] is False
    assert "R N B Q K" in state["board"].replace("  ", " ").upper()


def test_build_state_material_from_black_point_of_view() -> None:
    board = chess.Board("r6k/8/8/8/8/8/8/Q6K b - - 0 1")
    state = build_state(board, [], JevConfig(history_plies=0))
    assert state["material"]["for_side_to_move"] == -4
    assert state["recent_moves_san"] == []


def test_build_request_criteria_cover_every_legal_move() -> None:
    board = chess.Board(ITALIAN)
    request = build_request(board, [], JevConfig())
    question = request["questions"]["move"]
    assert isinstance(question, Choice)
    assert set(question.criteria) == {m.uci() for m in board.legal_moves}
    assert "playing white" in str(question.instructions)
    assert "eval" not in request["questions"]


def test_build_request_with_eval_adds_score_question() -> None:
    request = build_request(chess.Board(), [], JevConfig(with_eval=True, style="terse"))
    eval_question = request["questions"]["eval"]
    assert isinstance(eval_question, Score)
    assert len(eval_question.criteria) == 7
    move_question = request["questions"]["move"]
    assert isinstance(move_question, Choice)
    # terse style keeps the SAN alone for quiet moves
    assert move_question.criteria["e2e4"] == "e4"


def test_parse_response_sorts_and_reads_telemetry() -> None:
    response = choice_response(
        {"a2a3": 0.1, "e2e4": 0.6, "d2d4": 0.3}, confidence=0.7, eval_score=4.5, input_tokens=None
    )
    ranking = parse_response(response, latency_ms=12.5)
    assert [c.uci for c in ranking.candidates] == ["e2e4", "d2d4", "a2a3"]
    assert ranking.top == Candidate("e2e4", 0.6)
    assert ranking.confidence == 0.7
    assert ranking.eval_score == 4.5
    assert ranking.input_tokens == 0
    assert ranking.latency_ms == 12.5
    assert ranking.rank_of("a2a3") == 3
    assert ranking.rank_of("h2h4") is None
    assert ranking.margin == pytest.approx(0.3)
    assert ranking.top_k(2) == (Candidate("e2e4", 0.6), Candidate("d2d4", 0.3))


def test_parse_response_ties_break_alphabetically() -> None:
    ranking = parse_response(choice_response({"b1c3": 0.5, "a2a3": 0.5}), 0.0)
    assert [c.uci for c in ranking.candidates] == ["a2a3", "b1c3"]


def test_ranking_invariants() -> None:
    with pytest.raises(ValueError, match="at least one"):
        JevRanking((), 0.0, "m", 0, 0, 0.0)
    with pytest.raises(ValueError, match="sorted"):
        JevRanking((Candidate("a", 0.1), Candidate("b", 0.9)), 0.0, "m", 0, 0, 0.0)
    single = JevRanking((Candidate("a", 1.0),), 1.0, "m", 0, 0, 0.0)
    assert single.margin == 1.0


def test_policy_runs_graph_sync_and_records_latency() -> None:
    fake = FakeClassifier()
    policy = JevPolicy(fake, JevConfig(history_plies=2))
    board = italian_board()
    ranking = policy.rank(board)
    assert len(ranking.candidates) == len(list(board.legal_moves))
    assert ranking.latency_ms >= 0
    state = fake.requests[0]["state"]
    assert isinstance(state, dict)
    assert state["recent_moves_san"] == ["Bc4", "Nf6"]


async def test_policy_runs_graph_async() -> None:
    fake = FakeClassifier(scripted=choice_response({"e2e4": 0.9, "d2d4": 0.1}, confidence=0.8))
    ranking = await JevPolicy(fake).arank(chess.Board())
    assert ranking.top.uci == "e2e4"
    assert ranking.confidence == 0.8
    assert len(fake.requests) == 1


def test_from_settings_builds_classifier_against_gateway(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    class SpyClassifier(FakeClassifier):
        def __init__(self, **kwargs: object) -> None:
            super().__init__()
            captured.update(kwargs)

    monkeypatch.setattr(jev_module, "TypeSafeClassifier", SpyClassifier)
    settings = GatewaySettings(
        _env_file=None,
        LANGSMITH_GATEWAY=True,
        LANGSMITH_GATEWAY_API_KEY="lsv2_x",
        TYPESAFE_API_KEY="lsv2_x",
        TYPESAFE_BASE_URL="https://gateway.smith.langchain.com/typesafe",
    )
    policy = JevPolicy.from_settings(settings, JevConfig(model="jev-pinned"))
    assert captured["model"] == "jev-pinned"
    assert captured["base_url"] == "https://gateway.smith.langchain.com/typesafe"
    assert str(captured["api_key"]) == "**********"
    assert policy.config.model == "jev-pinned"


def test_from_settings_defaults_load_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(jev_module, "TypeSafeClassifier", lambda **kwargs: FakeClassifier())
    for k, v in {
        "LANGSMITH_GATEWAY": "true",
        "LANGSMITH_GATEWAY_API_KEY": "lsv2_x",
        "TYPESAFE_API_KEY": "lsv2_x",
        "TYPESAFE_BASE_URL": "https://gateway.smith.langchain.com/typesafe",
    }.items():
        monkeypatch.setenv(k, v)
    assert JevPolicy.from_settings().config == JevConfig()


def test_history_san_replays_from_root() -> None:
    board = chess.Board("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1")
    board.push_uci("a1a8")
    assert history_san(board) == ["Ra8#"]


@pytest.mark.live
def test_live_jev_ranks_italian_through_gateway() -> None:
    ranking = JevPolicy.from_settings().rank(chess.Board(ITALIAN))
    assert ranking.model.startswith("jev")
    assert abs(sum(c.probability for c in ranking.candidates) - 1.0) < 0.05
    assert ranking.input_tokens > 500
