import chess
import pytest

from langchain_chess_systemone.describe import (
    DescriptionStyle,
    describe,
    describe_moves,
    material_balance,
    move_facts,
    static_exchange,
)

ITALIAN = "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"


def facts_for(fen: str, uci: str):
    board = chess.Board(fen)
    return move_facts(board, chess.Move.from_uci(uci))


def test_quiet_developing_move_is_safe():
    f = facts_for(ITALIAN, "b1c3")
    assert f.piece == "knight"
    assert f.captured is None
    assert f.capture_value == 0
    assert not f.gives_check
    assert f.see_gain == 0
    assert not f.lands_on_attacked_square
    assert not f.hangs_material


def test_capture_that_loses_the_exchange():
    f = facts_for(ITALIAN, "f3e5")
    assert f.captured == "pawn"
    assert f.capture_value == 1
    assert f.see_gain == -2
    assert f.attackers_after == 1
    assert f.defenders_after == 0
    assert f.hangs_material


def test_checking_sacrifice():
    f = facts_for(ITALIAN, "c4f7")
    assert f.gives_check
    assert not f.is_mate
    assert f.san == "Bxf7+"
    assert f.see_gain == -2


def test_castling_facts():
    f = facts_for(ITALIAN, "e1g1")
    assert f.castle == "kingside"
    assert f.piece == "king"
    assert f.san == "O-O"


def test_queenside_castling():
    f = facts_for("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "e1c1")
    assert f.castle == "queenside"


def test_mate_in_one():
    f = facts_for("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1", "a1a8")
    assert f.is_mate
    assert f.gives_check
    assert f.san == "Ra8#"


def test_en_passant_is_a_pawn_capture():
    f = facts_for("rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3", "e5f6")
    assert f.is_en_passant
    assert f.captured == "pawn"
    assert f.capture_value == 1


def test_promotion_uses_promoted_piece_value():
    f = facts_for("8/P6k/8/8/8/8/8/K7 w - - 0 1", "a7a8q")
    assert f.promotion == "queen"
    assert f.see_gain == 0


def test_promotion_onto_attacked_square_hangs_the_queen():
    board = chess.Board("1r6/P6k/8/8/8/8/8/K7 w - - 0 1")
    assert static_exchange(board, chess.Move.from_uci("a7a8q")) == -9


def test_winning_exchange():
    # Queen takes an undefended rook.
    board = chess.Board("r6k/8/8/8/8/8/8/Q6K w - - 0 1")
    assert static_exchange(board, chess.Move.from_uci("a1a8")) == 5


def test_pinned_defender_does_not_count_in_exchange():
    # Black knight on d7 is pinned to the king by the rook on d1, so it cannot recapture on e5.
    board = chess.Board("3k4/3n4/8/4p3/8/8/4N3/3RK3 w - - 0 1")
    facts = move_facts(board, chess.Move.from_uci("e2c3"))
    assert facts.see_gain == 0
    # Compare: a knight capture on e5 would be recaptured only by non-pinned pieces.
    board2 = chess.Board("3k4/3n4/8/4p3/8/8/8/3RK1N1 w - - 0 1")
    assert static_exchange(board2, chess.Move.from_uci("g1f3")) == 0


def test_illegal_move_is_rejected():
    board = chess.Board()
    with pytest.raises(ValueError, match="not legal"):
        move_facts(board, chess.Move.from_uci("e2e5"))


def desc(fen: str, uci: str, style: DescriptionStyle = "rich") -> str:
    board = chess.Board(fen)
    return describe(move_facts(board, chess.Move.from_uci(uci)), style)


def test_rich_capture_losing_exchange():
    assert desc(ITALIAN, "f3e5") == (
        "Nxe5: knight f3 to e5, captures pawn (1), loses material in the exchange (-2), "
        "square attacked 1x, undefended"
    )


def test_rich_check_and_capture_order():
    assert desc(ITALIAN, "c4f7").startswith(
        "Bxf7+: bishop c4 to f7, gives check, captures pawn (1)"
    )


def test_rich_quiet_move_with_defenders():
    assert desc(ITALIAN, "d2d4") == "d4: pawn d2 to d4, square attacked 2x, defended 2x"


def test_rich_castling():
    assert desc(ITALIAN, "e1g1") == "O-O: castles kingside, king to g1, square safe"


def test_rich_mate():
    assert desc("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1", "a1a8") == (
        "Ra8#: rook a1 to a8, checkmate, square safe"
    )


def test_rich_en_passant_and_promotion():
    ep = desc("rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3", "e5f6")
    assert "captures pawn (1) en passant" in ep
    promo = desc("8/P6k/8/8/8/8/8/K7 w - - 0 1", "a7a8q")
    assert promo == "a8=Q: pawn a7 to a8, promotes to queen, square safe"


def test_rich_winning_exchange():
    assert "wins material in the exchange (+5)" in desc("r6k/8/8/8/8/8/8/Q6K w - - 0 1", "a1a8")


def test_terse_keeps_only_the_first_tactical_phrase():
    assert desc(ITALIAN, "c4f7", "terse") == "Bxf7+: gives check"
    assert desc(ITALIAN, "f3e5", "terse") == "Nxe5: captures pawn (1)"
    assert desc(ITALIAN, "b1c3", "terse") == "Nc3"


def test_describe_moves_keeps_the_given_order():
    board = chess.Board(ITALIAN)
    criteria = describe_moves(board, ["d2d4", "b1c3"])
    assert list(criteria) == ["d2d4", "b1c3"]
    assert criteria["b1c3"].startswith("Nc3: knight b1 to c3")


def test_material_balance():
    start = material_balance(chess.Board())
    assert (start.white, start.black, start.diff) == (39, 39, 0)
    assert material_balance(chess.Board("r6k/8/8/8/8/8/8/Q6K w - - 0 1")).diff == 4
