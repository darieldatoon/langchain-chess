"""scripts/openings.py keys positions as packages/chess-ui/src/openings.ts does."""

import importlib.util
import json
from pathlib import Path

import chess
import pytest

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = ROOT / "packages/chess-ui/tests/fixtures/position-keys.json"
GENERATED = ROOT / "packages/chess-ui/src/generated/openings.json"


def _script():
    spec = importlib.util.spec_from_file_location("openings", ROOT / "scripts/openings.py")
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("case", json.loads(FIXTURE.read_text()), ids=lambda c: c["name"])
def test_the_shared_fixture_keys_positions_as_the_script_does(case):
    assert _script().position_key(chess.Board(case["fen"])) == case["key"]


def test_only_a_row_s_final_position_is_named_and_the_shortest_row_wins():
    script = _script()
    rows = [
        ("B20", "Sicilian Defense", "1. e4 c5"),
        ("B27", "Sicilian Defense: Later", "1. e4 c5 2. Nf3"),
        ("B27", "Sicilian Defense: Longer route", "1. Nf3 c5 2. e4"),
    ]
    positions = script.positions(rows)
    after_e4 = script.position_key(script.final_board("1. e4")[0])
    assert after_e4 not in positions
    nf3 = script.position_key(script.final_board("1. e4 c5 2. Nf3")[0])
    assert positions[nf3] == ["B27", "Sicilian Defense: Later"]


def test_the_committed_table_is_cc0_lichess_data():
    table = json.loads(GENERATED.read_text())
    assert table["license"] == "CC0-1.0"
    assert table["source"] == "https://github.com/lichess-org/chess-openings"
    sicilian = chess.Board()
    for san in ("e4", "c5"):
        sicilian.push_san(san)
    assert table["positions"][sicilian.epd()] == ["B20", "Sicilian Defense"]
