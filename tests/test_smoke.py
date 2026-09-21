import chess

from jev_chess.cli import app


def test_package_imports() -> None:
    assert app is not None


def test_python_chess_generates_legal_moves() -> None:
    board = chess.Board()
    assert len(list(board.legal_moves)) == 20
