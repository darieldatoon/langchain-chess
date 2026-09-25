import pytest
from typer.testing import CliRunner

from langchain_chess_cli.main import app


def test_help_lists_commands():
    result = CliRunner().invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "uci" in result.output
    assert "play" in result.output


@pytest.mark.parametrize("command", ["uci", "play"])
def test_placeholders_exit_nonzero(command):
    assert CliRunner().invoke(app, [command]).exit_code == 1
