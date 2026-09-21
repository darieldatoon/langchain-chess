from pathlib import Path

import chess
import pytest
from typer.testing import CliRunner

from jev_chess import cli
from jev_chess.cli import app
from jev_chess.engines import MaiaOpponent, Oracle
from jev_chess.settings import EngineSettings
from tests.fakes import FakeBackend, info

runner = CliRunner()
ITALIAN = "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"


def test_version_prints_package_version() -> None:
    result = runner.invoke(app, ["version"])
    assert result.exit_code == 0
    assert result.output.strip() == "0.1.0"


def test_no_args_shows_help() -> None:
    result = runner.invoke(app, [])
    assert "System 1 vs System 2" in result.output


def test_facts_rich_and_terse() -> None:
    rich = runner.invoke(app, ["facts", ITALIAN])
    assert rich.exit_code == 0
    assert "white to move, material 39:39" in rich.output
    assert "loses material in the exchange" in rich.output
    terse = runner.invoke(app, ["facts", ITALIAN, "--style", "terse"])
    assert terse.exit_code == 0
    assert "captures pawn (1)" in terse.output


def test_facts_rejects_bad_style_and_bad_fen() -> None:
    assert runner.invoke(app, ["facts", ITALIAN, "--style", "loud"]).exit_code != 0
    assert runner.invoke(app, ["facts", "not a fen"]).exit_code != 0


def test_oracle_command_renders_ranking(monkeypatch: pytest.MonkeyPatch) -> None:
    backend = FakeBackend(scripted_infos=[info("a1a8", mate=1), info("a1a2", cp=900)])
    monkeypatch.setattr(cli, "EngineSettings", lambda: EngineSettings(_env_file=None))
    monkeypatch.setattr(
        Oracle, "open", classmethod(lambda cls, path, config: Oracle(backend, config))
    )
    result = runner.invoke(app, ["oracle", "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1", "--depth", "8"])
    assert result.exit_code == 0, result.output
    assert "Ra8#" in result.output
    assert backend.limits[0].depth == 8
    assert backend.quit_called


def test_maia_command(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    backend = FakeBackend(scripted_move=chess.Move.from_uci("e2e4"))
    monkeypatch.setattr(
        cli, "EngineSettings", lambda: EngineSettings(_env_file=None, maia_weights_dir=tmp_path)
    )
    monkeypatch.setattr(
        MaiaOpponent,
        "open",
        classmethod(lambda cls, rating, weights_dir, lc0_path: MaiaOpponent(backend, rating)),
    )
    result = runner.invoke(app, ["maia", chess.STARTING_FEN, "--rating", "1500"])
    assert result.exit_code == 0, result.output
    assert "maia-1500: e4 (e2e4)" in result.output
    assert runner.invoke(app, ["maia", chess.STARTING_FEN, "--rating", "1250"]).exit_code != 0
