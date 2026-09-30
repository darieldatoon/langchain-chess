"""Write packages/chess-ui/src/generated/openings.json from Lichess's CC0 opening names.

Run by hand: `uv run --all-packages python scripts/openings.py --commit <sha>`, where <sha> is a
commit of https://github.com/lichess-org/chess-openings. Only each row's final position is keyed,
so an earlier position is never named after a later variation.
"""

import argparse
import io
import json
import urllib.request
from pathlib import Path

import chess
import chess.pgn

REPO = "lichess-org/chess-openings"
FILES = ("a.tsv", "b.tsv", "c.tsv", "d.tsv", "e.tsv")
OUT = Path(__file__).resolve().parent.parent / "packages/chess-ui/src/generated/openings.json"


def position_key(board: chess.Board) -> str:
    """Placement, side to move, castling, and an en passant square only when the capture is
    legal. `positionKey` in packages/chess-ui/src/openings.ts must agree (a shared fixture checks).
    """
    return board.epd(en_passant="legal")


def final_board(pgn: str) -> tuple[chess.Board, int]:
    game = chess.pgn.read_game(io.StringIO(pgn))
    assert game is not None
    board = game.board()
    plies = 0
    for move in game.mainline_moves():
        board.push(move)
        plies += 1
    return board, plies


def positions(rows: list[tuple[str, str, str]]) -> dict[str, list[str]]:
    """Each row's final position. Of rows ending in one position, the one with fewer plies wins,
    then the earlier one."""
    best: dict[str, tuple[int, int, str, str]] = {}
    for order, (eco, name, pgn) in enumerate(rows):
        board, plies = final_board(pgn)
        key = position_key(board)
        if key not in best or (plies, order) < best[key][:2]:
            best[key] = (plies, order, eco, name)
    return {key: [eco, name] for key, (_, _, eco, name) in sorted(best.items())}


def fetch(commit: str, name: str) -> str:
    url = f"https://raw.githubusercontent.com/{REPO}/{commit}/{name}"
    with urllib.request.urlopen(url, timeout=30) as response:
        return response.read().decode()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--commit", required=True, help=f"a commit of {REPO}")
    commit = parser.parse_args().commit
    rows: list[tuple[str, str, str]] = []
    for name in FILES:
        lines = fetch(commit, name).splitlines()
        for line in lines[1:]:
            eco, title, pgn = line.split("\t")
            rows.append((eco, title, pgn))
    out = {
        "source": f"https://github.com/{REPO}",
        "commit": commit,
        "license": "CC0-1.0",
        "positions": positions(rows),
    }
    OUT.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False) + "\n")
    print(f"{len(out['positions'])} positions from {len(rows)} rows -> {OUT}")


if __name__ == "__main__":
    main()
