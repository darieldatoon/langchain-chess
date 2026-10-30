import io
import json
from importlib.resources import files
from pathlib import Path
from urllib.parse import unquote

import chess
import chess.pgn

from langchain_chess_cli.tui.export import (
    LICHESS_URL_LIMIT,
    lichess_url,
    pgn_date,
    pgn_file_name,
    to_pgn,
)
from langchain_chess_cli.tui.openings import Opening, opening_at, position_key, table
from langchain_chess_cli.tui.view import positions

ROOT = Path(__file__).resolve().parents[3]
SICILIAN = ["e2e4", "c7c5", "g1f3", "b8c6"]


def test_the_table_is_the_web_apps_file():
    shipped = files("langchain_chess_cli.tui").joinpath("openings.json").read_text()
    web = (ROOT / "packages/chess-ui/src/generated/openings.json").read_text()
    assert shipped == web
    assert json.loads(shipped)["license"] == "CC0-1.0"


def test_the_opening_holds_after_the_game_leaves_the_book():
    fens = positions({"moves": [*SICILIAN, "a2a3", "a7a6"]})
    assert opening_at(fens, 4, table()) == Opening("B30", "Sicilian Defense: Old Sicilian", 4)
    assert opening_at(fens, 6, table()) == opening_at(fens, 4, table())
    assert opening_at(fens, 0, table()) is None
    assert opening_at(fens, 4, table()).title == "B30 · Sicilian Defense: Old Sicilian"


def test_transpositions_are_named_by_position():
    via_nf3 = positions({"moves": ["g1f3", "c7c5", "e2e4", "b8c6"]})
    assert opening_at(via_nf3, 4, table()).name == "Sicilian Defense: Old Sicilian"


def test_position_keys_match_the_web_apps():
    fixture = json.loads((ROOT / "packages/chess-ui/tests/fixtures/position-keys.json").read_text())
    for case in fixture:
        assert position_key(case["fen"]) == case["key"]


def read(pgn):
    game = chess.pgn.read_game(io.StringIO(pgn))
    assert game is not None
    return game


def test_the_pgn_has_the_web_apps_headers_and_comments():
    values = {
        "moves": SICILIAN,
        "turns": [{"calls": [{"called_at": "2026-10-02T05:00:00+00:00"}]}],
        "outcome": {"kind": "checkmate", "winner": "white"},
    }
    opening = opening_at(positions(values), 4, table())
    pgn = to_pgn(values, white="You", black="Jev", comment="Jev · Thread t", opening=opening)
    game = read(pgn)
    assert list(game.headers.items()) == [
        ("Event", "LangChain Chess"),
        ("Site", "lcchess play"),
        ("Date", "2026.10.02"),
        ("Round", "-"),
        ("White", "You"),
        ("Black", "Jev"),
        ("Result", "1-0"),
        ("Termination", "Normal"),
        ("Annotator", "LangChain Chess"),
    ]
    assert game.comment == "Jev · Thread t"
    assert [m.uci() for m in game.mainline_moves()] == SICILIAN
    assert game.end().comment == "B30 Sicilian Defense: Old Sicilian"
    assert pgn.endswith("1-0\n")


def test_a_custom_root_sets_up_the_position():
    root = "8/P6k/8/8/8/8/8/K7 w - - 0 1"
    pgn = to_pgn(
        {"start_fen": root, "moves": ["a7a8q"]}, white="W", black="B", comment=None, opening=None
    )
    game = read(pgn)
    keys = list(game.headers)
    assert keys[keys.index("Result") + 1 : keys.index("Result") + 3] == ["SetUp", "FEN"]
    assert game.headers["FEN"] == root
    assert game.headers["Date"] == "????.??.??"
    assert game.headers["Result"] == "*"
    assert game.headers["Termination"] == "Unterminated"
    assert game.comment == ""
    assert game.end().board().piece_at(chess.A8) == chess.Piece(chess.QUEEN, chess.WHITE)


def test_an_opening_at_the_root_joins_the_leading_comment():
    opening = Opening("B20", "Sicilian Defense", 0)
    pgn = to_pgn({}, white="W", black="B", comment="Thread t", opening=opening)
    assert read(pgn).comment == "Thread t B20 Sicilian Defense"


def test_pgn_date_before_any_call():
    assert pgn_date({"turns": [{"calls": []}]}) == "????.??.??"


def test_the_lichess_link_carries_the_game_or_falls_back_to_the_position():
    url, fallback = lichess_url("1. e4 *", chess.STARTING_FEN)
    assert not fallback
    assert unquote(url.removeprefix("https://lichess.org/analysis/pgn/")) == "1. e4 *"
    long, fallback = lichess_url("x" * LICHESS_URL_LIMIT, chess.STARTING_FEN)
    assert fallback
    assert long == "https://lichess.org/analysis/" + chess.STARTING_FEN.replace(" ", "_")


def test_pgn_file_name():
    assert pgn_file_name("tui-1") == "langchain-chess-tui-1.pgn"


def test_results_and_a_black_root_number_from_the_root():
    root = "4k3/8/8/8/8/8/4P3/4K3 b - - 0 41"
    resigned = {"kind": "resignation", "winner": "white", "reason": "resigned"}
    pgn = to_pgn(
        {"start_fen": root, "moves": ["e8d7", "e2e4"], "outcome": resigned},
        white="W",
        black="B",
        comment=None,
        opening=None,
    )
    assert "41... Kd7 42. e4 1-0" in pgn
    drawn = {"kind": "draw", "reason": "threefold"}
    assert (
        read(to_pgn({"outcome": drawn}, white="W", black="B", comment=None, opening=None)).headers[
            "Result"
        ]
        == "1/2-1/2"
    )
