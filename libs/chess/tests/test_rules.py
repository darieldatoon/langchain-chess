import chess
import pytest

from langchain_chess.rules import (
    CommandError,
    describe_outcome,
    ending,
    fingerprint,
    legal_member,
    parse_chat,
    replay,
    result_text,
    root_board,
    score,
)
from langchain_chess.state import Outcome

SHUFFLE = ["g1f3", "g8f6", "f3g1", "f6g8"]
FOOLS_MATE = ["f2f3", "e7e5", "g2g4", "d8h4"]


def test_checkmate_and_automatic_draws():
    assert ending(replay(chess.STARTING_FEN, FOOLS_MATE, "never"), "never") == {
        "kind": "checkmate",
        "winner": "black",
    }
    stalemate = chess.Board("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1")
    assert ending(stalemate, "never") == {"kind": "draw", "reason": "stalemate"}
    bare = chess.Board("8/8/8/4k3/8/8/8/4K3 w - - 0 1")
    assert ending(bare, "never") == {"kind": "draw", "reason": "insufficient_material"}
    assert ending(replay(chess.STARTING_FEN, SHUFFLE * 4, "never"), "never") == {
        "kind": "draw",
        "reason": "fivefold",
    }
    seventy_five = chess.Board("7k/8/8/8/8/8/R7/K7 w - - 150 100")
    assert ending(seventy_five, "never") == {"kind": "draw", "reason": "seventyfive_moves"}


def test_claimed_draws_only_with_auto_and_only_once_they_occurred():
    twice = replay(chess.STARTING_FEN, SHUFFLE * 2, "never")
    assert ending(twice, "auto") == {"kind": "draw", "reason": "threefold"}
    assert ending(twice, "never") is None
    # One move short: a draw is claimable by the next move, but hasn't happened yet.
    almost = replay(chess.STARTING_FEN, [*SHUFFLE, *SHUFFLE[:3]], "never")
    assert almost.can_claim_threefold_repetition()
    assert ending(almost, "auto") is None
    fifty = chess.Board("7k/8/8/8/8/8/R7/K7 w - - 100 80")
    assert ending(fifty, "auto") == {"kind": "draw", "reason": "fifty_moves"}
    assert ending(fifty, "never") is None


def test_replay_rejects_moves_after_an_ending():
    with pytest.raises(CommandError, match="after the game ended"):
        replay(chess.STARTING_FEN, [*SHUFFLE * 4, "e2e4"], "never")
    with pytest.raises(CommandError, match="draw by threefold"):
        replay(chess.STARTING_FEN, [*SHUFFLE * 2, "e2e4"], "auto")
    with pytest.raises(CommandError, match="checkmate, black wins"):
        replay(chess.STARTING_FEN, [*FOOLS_MATE, "a2a3"], "never")


def test_root_board_validation():
    with pytest.raises(CommandError, match="invalid FEN"):
        root_board("not a fen")
    with pytest.raises(CommandError, match="invalid position"):
        root_board("8/8/8/8/8/8/8/8 w - - 0 1")
    assert root_board(chess.STARTING_FEN).fen() == chess.STARTING_FEN


def test_legal_member_rejects_null_and_illegal_moves():
    board = chess.Board()
    assert legal_member(board, "e2e4") == chess.Move.from_uci("e2e4")
    with pytest.raises(CommandError, match="not a legal move"):
        legal_member(board, "0000")
    with pytest.raises(CommandError, match="not a UCI move"):
        legal_member(board, "zz")


@pytest.mark.parametrize("text", ["--", "Z0", "0000", "@@@@", "e5", "e4 d4", "hello"])
def test_parse_chat_rejects_anything_but_go_or_one_legal_move(text):
    with pytest.raises(CommandError):
        parse_chat(chess.Board(), text)


def test_parse_chat_accepts_go_san_and_uci():
    board = chess.Board()
    assert parse_chat(board, " GO ") is None
    assert parse_chat(board, "Nf3") == chess.Move.from_uci("g1f3")
    assert parse_chat(board, "e2e4") == chess.Move.from_uci("e2e4")


def test_fingerprint_ignores_restrict_order_but_not_its_presence():
    a = fingerprint(chess.STARTING_FEN, [], ["e2e4", "d2d4"])
    assert a == fingerprint(chess.STARTING_FEN, [], ["d2d4", "e2e4"])
    assert a != fingerprint(chess.STARTING_FEN, [], None)
    assert fingerprint(chess.STARTING_FEN, ["e2e4"], None) != fingerprint(
        chess.STARTING_FEN, [], None
    )


def test_result_text_and_score():
    assert result_text({"kind": "checkmate", "winner": "white"}) == "Checkmate, white wins. 1-0"
    assert result_text({"kind": "draw", "reason": "threefold"}) == "Draw by threefold. 1/2-1/2"
    resign: Outcome = {"kind": "resignation", "winner": "white", "reason": "illegal_moves"}
    assert result_text(resign) == "Black resigns after repeated illegal moves. 1-0"
    assert score({"kind": "resignation", "winner": "black", "reason": "illegal_moves"}) == "0-1"
    assert describe_outcome(resign) == "white wins by resignation"
    fifty: Outcome = {"kind": "draw", "reason": "fifty_moves"}
    assert describe_outcome(fifty) == "draw by fifty moves"


def test_a_loss_on_time():
    timeout = {"kind": "timeout", "winner": "black"}
    assert result_text(timeout) == "White runs out of time. 0-1"
    assert describe_outcome(timeout) == "black wins on time"
