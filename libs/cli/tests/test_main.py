import pytest
from typer.testing import CliRunner

from langchain_chess_cli import main
from langchain_chess_cli.main import app


def test_help_lists_commands():
    result = CliRunner().invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "uci" in result.output
    assert "play" in result.output


def test_play_is_a_placeholder():
    assert CliRunner().invoke(app, ["play"]).exit_code == 1


def test_uci_speaks_the_protocol(monkeypatch):
    monkeypatch.setenv("LANGSMITH_GATEWAY", "false")
    result = CliRunner().invoke(app, ["uci", "--policy", "systemone"], input="uci\nisready\nquit\n")
    assert result.exit_code == 0, result.output
    lines = result.output.splitlines()
    assert lines[0] == "id name langchain-chess"
    assert lines[-1] == "readyok"


@pytest.mark.parametrize("flag", [["--gate", "vibes"], ["--style", "long"]])
def test_bad_choices(flag):
    result = CliRunner().invoke(app, ["uci", *flag], input="quit\n")
    assert result.exit_code == 2


def test_the_uci_factory_builds_real_agents(monkeypatch):
    built = []
    monkeypatch.setattr(main, "build_agent", lambda options, **kw: built.append(kw) or object())

    class FakeEngine:
        def __init__(self, factory, options, out):
            factory(options, None)
            out("hello")

    async def fake_run(engine):
        return None

    import langchain_chess_cli.uci.engine as engine_module

    monkeypatch.setattr(engine_module, "Engine", FakeEngine)
    monkeypatch.setattr(engine_module, "run", fake_run)
    result = CliRunner().invoke(app, ["uci"])
    assert result.output == "hello\n"
    assert built[0]["draw_claims"] == "never"
