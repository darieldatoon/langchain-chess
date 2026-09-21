import chess

from jev_chess.core import DescriptionStyle, all_move_facts, describe, describe_all, move_facts

ITALIAN = "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"


def desc(fen: str, uci: str, style: DescriptionStyle = "rich") -> str:
    board = chess.Board(fen)
    return describe(move_facts(board, chess.Move.from_uci(uci)), style)


def test_rich_capture_losing_exchange() -> None:
    assert desc(ITALIAN, "f3e5") == (
        "Nxe5: knight f3 to e5, captures pawn (1), loses material in the exchange (-2), "
        "square attacked 1x, undefended"
    )


def test_rich_check_and_capture_order() -> None:
    assert desc(ITALIAN, "c4f7").startswith(
        "Bxf7+: bishop c4 to f7, gives check, captures pawn (1)"
    )


def test_rich_quiet_move_with_defenders() -> None:
    assert desc(ITALIAN, "d2d4") == "d4: pawn d2 to d4, square attacked 2x, defended 2x"


def test_rich_castling() -> None:
    assert desc(ITALIAN, "e1g1") == "O-O: castles kingside, king to g1, square safe"


def test_rich_mate() -> None:
    assert desc("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1", "a1a8") == (
        "Ra8#: rook a1 to a8, checkmate, square safe"
    )


def test_rich_en_passant_and_promotion() -> None:
    ep = desc("rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3", "e5f6")
    assert "captures pawn (1) en passant" in ep
    promo = desc("8/P6k/8/8/8/8/8/K7 w - - 0 1", "a7a8q")
    assert promo == "a8=Q: pawn a7 to a8, promotes to queen, square safe"


def test_rich_winning_exchange() -> None:
    assert "wins material in the exchange (+5)" in desc("r6k/8/8/8/8/8/8/Q6K w - - 0 1", "a1a8")


def test_terse_keeps_only_the_first_tactical_phrase() -> None:
    assert desc(ITALIAN, "c4f7", "terse") == "Bxf7+: gives check"
    assert desc(ITALIAN, "f3e5", "terse") == "Nxe5: captures pawn (1)"
    assert desc(ITALIAN, "b1c3", "terse") == "Nc3"


def test_describe_all_keys_match_legal_moves() -> None:
    board = chess.Board(ITALIAN)
    facts = all_move_facts(board)
    criteria = describe_all(facts)
    assert set(criteria) == {m.uci() for m in board.legal_moves}
    assert all(v.startswith(f.san) for f, v in zip(facts, criteria.values(), strict=True))
