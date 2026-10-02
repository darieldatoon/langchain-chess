import chess
import pytest

from langchain_chess_cli.tui.view import (
    Entry,
    board_at,
    board_of,
    entries,
    material_diff,
    material_score,
    material_text,
    move_rows,
    positions,
    result_headline,
    score_text,
    strip_result,
)

BLACK_TO_MOVE = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 7"


def test_positions_and_boards_replay_from_the_root():
    values = {"start_fen": BLACK_TO_MOVE, "moves": ["e7e5", "g1f3"]}
    fens = positions(values)
    assert fens[0] == chess.Board(BLACK_TO_MOVE).fen()
    assert len(fens) == 3
    assert board_of(values).fen() == fens[2]
    assert board_at(values, 1).fen() == fens[1]
    assert board_at({}, 0).fen() == chess.STARTING_FEN


def test_material_counts_the_board_alone():
    # White has won a pawn and promoted a queen; Black has an extra knight.
    board = chess.Board("4k3/8/8/8/8/2n5/PPP5/QQ2K3 w - - 0 1")
    diff = material_diff(board)
    assert diff["white"][chess.QUEEN] == 2
    assert diff["white"][chess.PAWN] == 3
    assert diff["black"][chess.KNIGHT] == 1
    assert material_score(board) == 18 + 3 - 3
    assert material_text(board, "white") == "♕♕♙♙♙ +18"
    assert material_text(board, "black") == "♞"
    assert material_text(chess.Board(), "white") == ""


def test_move_rows_number_from_a_black_to_move_root():
    moves = [Entry(0, "e5", "llm"), Entry(1, "Nf3", "external"), Entry(2, "Nc6", "systemone")]
    assert move_rows(moves, BLACK_TO_MOVE) == [
        (7, None, moves[0]),
        (8, moves[1], moves[2]),
    ]
    assert move_rows([], chess.STARTING_FEN) == []


def test_entries_come_from_the_plies():
    plies = [{"ply": 0, "san": "e4", "source": "external"}]
    assert entries({"plies": plies}) == [Entry(0, "e4", "external")]
    assert entries({}) == []


@pytest.mark.parametrize(
    ("outcome", "white", "black", "score", "headline"),
    [
        ({"kind": "draw", "reason": "stalemate"}, "Draw", "Draw", "½-½", "Draw"),
        ({"kind": "checkmate", "winner": "white"}, "Won", "Checkmated", "1-0", "You won"),
        (
            {"kind": "resignation", "winner": "black", "reason": "resigned"},
            "Resigned",
            "Won",
            "0-1",
            "You lost",
        ),
        (
            {"kind": "resignation", "winner": "white", "reason": "illegal_moves"},
            "Won",
            "Forfeited",
            "1-0",
            "You won",
        ),
    ],
)
def test_the_result_in_a_word_per_side(outcome, white, black, score, headline):
    assert strip_result(outcome, "white") == white
    assert strip_result(outcome, "black") == black
    assert score_text(outcome) == score
    assert result_headline(outcome, "white") == headline
