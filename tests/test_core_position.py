import chess

from jev_chess.core import legal_moves_uci, material_balance, movetext, snapshot


def test_snapshot_of_start_position() -> None:
    pos = snapshot(chess.Board())
    assert pos.fen == chess.STARTING_FEN
    assert pos.pgn == ""
    assert pos.side == "white"
    assert len(pos.legal_moves) == 20
    assert pos.legal_moves == tuple(sorted(pos.legal_moves))


def test_snapshot_records_movetext_and_side() -> None:
    board = chess.Board()
    for uci in ("e2e4", "e7e5", "g1f3"):
        board.push_uci(uci)
    pos = snapshot(board)
    assert pos.pgn == "1. e4 e5 2. Nf3"
    assert pos.side == "black"


def test_movetext_from_custom_root() -> None:
    board = chess.Board("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1")
    board.push_uci("a1a8")
    assert movetext(board) == "1. Ra8#"
    assert legal_moves_uci(board) == ()


def test_material_balance() -> None:
    start = material_balance(chess.Board())
    assert (start.white, start.black, start.diff) == (39, 39, 0)
    up_a_rook = material_balance(chess.Board("r6k/8/8/8/8/8/8/Q6K w - - 0 1"))
    assert up_a_rook.diff == 4


def test_movetext_from_san_replays_from_the_start() -> None:
    from jev_chess.core import movetext_from_san

    assert movetext_from_san([]) == ""
    assert movetext_from_san(["e4", "e5", "Nf3"]) == "1. e4 e5 2. Nf3"
