import chess
import pytest

from jev_chess.core import all_move_facts, move_facts, static_exchange

ITALIAN = "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"


def facts_for(fen: str, uci: str):
    board = chess.Board(fen)
    return move_facts(board, chess.Move.from_uci(uci))


def test_quiet_developing_move_is_safe() -> None:
    f = facts_for(ITALIAN, "b1c3")
    assert f.piece == "knight"
    assert f.captured is None
    assert f.capture_value == 0
    assert not f.gives_check
    assert f.see_gain == 0
    assert not f.lands_on_attacked_square
    assert not f.hangs_material


def test_capture_that_loses_the_exchange() -> None:
    f = facts_for(ITALIAN, "f3e5")
    assert f.captured == "pawn"
    assert f.capture_value == 1
    assert f.see_gain == -2
    assert f.attackers_after == 1
    assert f.defenders_after == 0
    assert f.hangs_material


def test_checking_sacrifice() -> None:
    f = facts_for(ITALIAN, "c4f7")
    assert f.gives_check
    assert not f.is_mate
    assert f.san == "Bxf7+"
    assert f.see_gain == -2


def test_castling_facts() -> None:
    f = facts_for(ITALIAN, "e1g1")
    assert f.castle == "kingside"
    assert f.piece == "king"
    assert f.san == "O-O"


def test_queenside_castling() -> None:
    f = facts_for("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "e1c1")
    assert f.castle == "queenside"


def test_mate_in_one() -> None:
    f = facts_for("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1", "a1a8")
    assert f.is_mate
    assert f.gives_check
    assert f.san == "Ra8#"


def test_en_passant_is_a_pawn_capture() -> None:
    f = facts_for("rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3", "e5f6")
    assert f.is_en_passant
    assert f.captured == "pawn"
    assert f.capture_value == 1


def test_promotion_uses_promoted_piece_value() -> None:
    f = facts_for("8/P6k/8/8/8/8/8/K7 w - - 0 1", "a7a8q")
    assert f.promotion == "queen"
    assert f.see_gain == 0


def test_promotion_onto_attacked_square_hangs_the_queen() -> None:
    board = chess.Board("1r6/P6k/8/8/8/8/8/K7 w - - 0 1")
    assert static_exchange(board, chess.Move.from_uci("a7a8q")) == -9


def test_winning_exchange() -> None:
    # Queen takes an undefended rook.
    board = chess.Board("r6k/8/8/8/8/8/8/Q6K w - - 0 1")
    assert static_exchange(board, chess.Move.from_uci("a1a8")) == 5


def test_pinned_defender_does_not_count_in_exchange() -> None:
    # Black knight on d7 is pinned to the king by the rook on d1, so it cannot recapture on e5.
    board = chess.Board("3k4/3n4/8/4p3/8/8/4N3/3RK3 w - - 0 1")
    facts = move_facts(board, chess.Move.from_uci("e2c3"))
    assert facts.see_gain == 0
    # Compare: a knight capture on e5 would be recaptured only by non-pinned pieces.
    board2 = chess.Board("3k4/3n4/8/4p3/8/8/8/3RK1N1 w - - 0 1")
    assert static_exchange(board2, chess.Move.from_uci("g1f3")) == 0


def test_illegal_move_is_rejected() -> None:
    board = chess.Board()
    with pytest.raises(ValueError, match="not legal"):
        move_facts(board, chess.Move.from_uci("e2e5"))


def test_all_move_facts_is_sorted_and_complete() -> None:
    board = chess.Board()
    facts = all_move_facts(board)
    assert len(facts) == 20
    assert [f.uci for f in facts] == sorted(f.uci for f in facts)
    assert board.fen() == chess.Board().fen()
