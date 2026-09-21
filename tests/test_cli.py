from typer.testing import CliRunner

from jev_chess.cli import app

runner = CliRunner()


def test_version_prints_package_version() -> None:
    result = runner.invoke(app, ["version"])
    assert result.exit_code == 0
    assert result.output.strip() == "0.1.0"


def test_no_args_shows_help() -> None:
    result = runner.invoke(app, [])
    assert "System 1 vs System 2" in result.output
