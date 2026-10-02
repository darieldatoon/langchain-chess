import chess
import pytest

from langchain_chess.rules import (
    CommandError,
    Go,
    OfferDraw,
    Play,
    Resign,
    control_command,
    decline_all,
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


def test_parse_chat_accepts_go_san_uci_resign_and_draw():
    board = chess.Board()
    assert parse_chat(board, " GO ") == Go()
    assert parse_chat(board, "Nf3") == Play(chess.Move.from_uci("g1f3"))
    assert parse_chat(board, "e2e4") == Play(chess.Move.from_uci("e2e4"))
    assert parse_chat(board, "Resign White") == Resign("white")
    assert parse_chat(board, "resign black") == Resign("black")
    assert parse_chat(board, " draw BLACK ") == OfferDraw("black")


@pytest.mark.parametrize("text", ["resign red", "draw both", "resign  white", "resign", "draw"])
def test_parse_chat_rejects_a_control_command_without_one_side(text):
    with pytest.raises(CommandError):
        parse_chat(chess.Board(), text)


def test_a_bad_side_says_how_to_name_one():
    with pytest.raises(CommandError, match="name the side, `resign white` or `resign black`"):
        control_command("resign red")
    assert control_command("e4") is None
    assert control_command("go") is None


@pytest.mark.parametrize(
    ("text", "forms"),
    [
        ("e8", "`e8=Q`, `e8=R`, `e8=B` or `e8=N`"),
        ("exd8", "`exd8=Q`, `exd8=R`, `exd8=B` or `exd8=N`"),
        ("e7e8", "`e7e8q`, `e7e8r`, `e7e8b` or `e7e8n`"),
        ("exd8+", "`exd8=Q`, `exd8=R`, `exd8=B` or `exd8=N`"),
    ],
)
def test_a_promotion_without_its_piece_names_the_fix(text, forms):
    board = chess.Board("3n3k/4P3/8/8/8/8/8/4K3 w - - 0 1")
    with pytest.raises(CommandError) as raised:
        parse_chat(board, text)
    assert str(raised.value) == f"`{text}` promotes; add the piece: {forms}"


def test_a_uci_move_that_isnt_a_promotion_gets_the_plain_error():
    board = chess.Board("3n3k/4P3/8/8/8/8/8/4K3 w - - 0 1")
    with pytest.raises(CommandError, match="neither `go` nor a legal move"):
        parse_chat(board, "h7h8")


def test_the_default_draw_policy_declines():
    assert decline_all(chess.Board(), "white") == "declined"


def test_fingerprint_ignores_restrict_order_but_not_its_presence():
    a = fingerprint(chess.STARTING_FEN, [], ["e2e4", "d2d4"])
    assert a == fingerprint(chess.STARTING_FEN, [], ["d2d4", "e2e4"])
    assert a != fingerprint(chess.STARTING_FEN, [], None)
    assert fingerprint(chess.STARTING_FEN, ["e2e4"], None) != fingerprint(
        chess.STARTING_FEN, [], None
    )


def test_result_text_and_score():
    assert result_text({"kind": "checkmate", "winner": "white"}) == "Checkmate · White wins. 1-0"
    assert (
        result_text({"kind": "draw", "reason": "threefold"})
        == "Draw by threefold repetition. 1/2-1/2"
    )
    forfeit: Outcome = {"kind": "resignation", "winner": "white", "reason": "illegal_moves"}
    assert result_text(forfeit) == "Black forfeited after repeated illegal moves · White wins. 1-0"
    assert score({"kind": "resignation", "winner": "black", "reason": "illegal_moves"}) == "0-1"
    assert describe_outcome(forfeit) == "white wins by forfeit"
    resigned: Outcome = {"kind": "resignation", "winner": "black", "reason": "resigned"}
    assert result_text(resigned) == "White resigned · Black wins. 0-1"
    assert describe_outcome(resigned) == "black wins, white resigned"
    fifty: Outcome = {"kind": "draw", "reason": "fifty_moves"}
    assert describe_outcome(fifty) == "draw by fifty moves"
