import chess
import pytest
from langchain_core.messages import AIMessage, HumanMessage

from langchain_chess.models import canonical_model, model_identity
from langchain_chess.parse import parse_move, text_of
from langchain_chess.position import movetext
from langchain_chess.prompt import delta_text, feedback_text, model_view, render_position

BLACK_TO_MOVE = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"


def test_movetext_numbers_from_any_root():
    assert movetext(chess.STARTING_FEN, ["e4", "e5", "Nf3"]) == "1. e4 e5 2. Nf3"
    assert movetext(chess.STARTING_FEN, ["e4", "c5", "Nf3"], first=1) == "1... c5 2. Nf3"
    assert movetext(BLACK_TO_MOVE, ["c5", "Nf3", "d6"]) == "1... c5 2. Nf3 d6"
    assert movetext(BLACK_TO_MOVE, ["c5", "Nf3"], first=1) == "2. Nf3"
    assert movetext(chess.STARTING_FEN, []) == ""


def test_text_of_joins_text_blocks():
    assert text_of(AIMessage("plain")) == "plain"
    blocks = AIMessage([{"type": "reasoning", "summary": []}, {"type": "text", "text": "a"}, "b"])
    assert text_of(blocks) == "a\nb"


@pytest.mark.parametrize(
    ("reply", "uci"),
    [
        ("I think Nf3.\nMOVE: e4", "e2e4"),
        ("MOVE: **Nf3**", "g1f3"),
        ("MOVE: e2e4", "e2e4"),
        ("maybe d4 or e4", "e2e4"),
        ("MOVE: Qh5\nMOVE: d4", "d2d4"),
    ],
)
def test_parse_move(reply, uci):
    move, reason = parse_move(chess.Board(), reply)
    assert move == chess.Move.from_uci(uci)
    assert reason is None


def test_parse_move_reasons():
    assert parse_move(chess.Board(), "no idea")[1] == (
        "no move found; end your reply with a line `MOVE: <move>`"
    )
    assert parse_move(chess.Board(), "MOVE: Qh5")[1] == "`Qh5` is not a legal move in this position"
    castle = chess.Board("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1")
    assert parse_move(castle, "MOVE: 0-0-0")[0] == chess.Move.from_uci("e1c1")
    assert parse_move(castle, "MOVE: o-o.")[0] == chess.Move.from_uci("e1g1")


def test_model_identity_prefers_the_gateway_prefix():
    assert model_identity("anthropic/claude-opus-5", "openai") == ("anthropic", "claude-opus-5")
    assert model_identity("langsmith:anthropic/claude-opus-5") == ("anthropic", "claude-opus-5")
    assert model_identity("anthropic:claude-opus-5") == ("anthropic", "claude-opus-5")
    assert model_identity("typesafe/jev-latest") == ("typesafe", "jev-latest")
    assert model_identity("claude-opus-5", "anthropic") == ("anthropic", "claude-opus-5")
    assert canonical_model("semif-qwen3.5-4b") == "unknown:semif-qwen3.5-4b"


def test_render_position_lists_legal_moves_or_only_the_permitted_ones():
    board = chess.Board()
    legal = [m.uci() for m in board.legal_moves]
    text = render_position(chess.STARTING_FEN, [], board, legal, None, show_legal_moves=True)
    assert text.startswith("Moves so far: (none, this is the first move)\nFEN: ")
    assert "White to move." in text
    assert "Legal moves: Nh3, Nf3" in text
    assert text.endswith("Reply with your analysis, then the final line `MOVE: <move>`.")
    hidden = render_position(chess.STARTING_FEN, [], board, legal, None, show_legal_moves=False)
    assert "Legal moves" not in hidden
    narrowed = render_position(
        chess.STARTING_FEN, [], board, ["e2e4", "d2d4"], ["g1f3", "d2d4"], show_legal_moves=True
    )
    assert "Suggested candidates: d4. These are suggested candidates" in narrowed
    assert "Only these moves are permitted: e4, d4." in narrowed
    assert "Legal moves" not in narrowed


def test_render_position_in_check():
    board = chess.Board("4k3/8/8/8/8/8/4q3/4K3 w - - 0 1")
    legal = [m.uci() for m in board.legal_moves]
    text = render_position(board.fen(), [], board, legal, [], show_legal_moves=True)
    assert "You are in check." in text
    assert "Suggested" not in text


def test_delta_and_feedback_text():
    assert delta_text(chess.STARTING_FEN, [], 0, chess.WHITE, had_moves=False) == (
        "New game. You are White."
    )
    assert delta_text(chess.STARTING_FEN, ["e4", "c5"], 1, chess.WHITE, had_moves=True) == "1... c5"
    assert delta_text(chess.STARTING_FEN, ["e4"], 1, chess.BLACK, had_moves=True) == (
        "Your move as Black."
    )
    board = chess.Board()
    assert feedback_text(board, ["e2e4"], "bad", empty=False) == (
        "Try again, that move was rejected: bad. Choose from: e4. "
        "Keep the reply short and end with `MOVE: <move>`."
    )
    assert "output budget was probably spent on reasoning" in feedback_text(
        board, ["e2e4"], "", empty=True
    )


def _turn(tid, opened, rejected=(), feedback=()):
    return {
        "id": tid,
        "opened_message_id": opened,
        "rejected_message_ids": list(rejected),
        "feedback_message_ids": list(feedback),
    }


def test_model_view_memory_modes():
    thinking = {"type": "reasoning", "summary": []}
    messages = [
        HumanMessage("open1", id="h1"),
        AIMessage("bad1", id="a1"),
        HumanMessage("fb1", id="f1"),
        AIMessage([thinking, {"type": "text", "text": "good1"}], id="a2"),
        HumanMessage("open2", id="h2"),
        AIMessage("bad2", id="a3"),
        HumanMessage("fb2", id="f2"),
        AIMessage([thinking, {"type": "text", "text": "bad3"}], id="a4"),
        HumanMessage("fb3", id="f3"),
    ]
    turns = [_turn("t1", "h1", ["a1"], ["f1"]), _turn("t2", "h2", ["a3", "a4"], ["f2", "f3"])]
    none = model_view(messages, turns, "none")
    assert [m.id for m in none] == ["h2", "f2", "a4", "f3"]
    assert none[2].content[0] == thinking  # the latest attempt keeps its blocks
    summarize = model_view(messages, turns, "summarize")
    assert [m.id for m in summarize] == ["h1", "a2", "h2", "f2", "a4", "f3"]
    assert summarize[1].content == [{"type": "text", "text": "good1"}]
    assert summarize[0] is not messages[0]


def test_parse_move_skips_null_moves():
    move, reason = parse_move(chess.Board(), "MOVE: 0000")
    assert move is None
    assert reason == "`0000` is not a legal move in this position"
