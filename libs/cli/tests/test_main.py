import re

import pytest
from typer.testing import CliRunner

from langchain_chess_cli import main
from langchain_chess_cli.main import app


def test_help_lists_commands():
    result = CliRunner().invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "uci" in result.output
    assert "play" in result.output


def test_play_runs_the_tui(monkeypatch):
    import langchain_chess_cli.tui.app as tui

    ran = []

    def fake_run(self):
        ran.append((self.side, self.settings.policy, self.settings.memory, self.agent.name))

    monkeypatch.setattr(tui.ChessApp, "run", fake_run)
    monkeypatch.setenv("LANGSMITH_GATEWAY", "false")
    args = ["play", "--side", "black", "--policy", "systemone", "--memory"]
    result = CliRunner().invoke(app, args)
    assert result.exit_code == 0, result.output
    assert ran == [("black", "systemone", True, "chess")]


def test_uci_speaks_the_protocol(monkeypatch):
    monkeypatch.setenv("LANGSMITH_GATEWAY", "false")
    result = CliRunner().invoke(app, ["uci", "--policy", "systemone"], input="uci\nisready\nquit\n")
    assert result.exit_code == 0, result.output
    lines = result.output.splitlines()
    assert lines[0] == "id name langchain-chess"
    assert lines[-1] == "readyok"


@pytest.mark.parametrize(
    "flag", [["--gate", "vibes"], ["--style", "long"], ["--model", ""], ["--move-list", "all"]]
)
def test_bad_choices(flag):
    result = CliRunner().invoke(app, ["uci", *flag], input="quit\n")
    assert result.exit_code == 2


def test_the_uci_factory_builds_real_agents(monkeypatch):
    built = []
    monkeypatch.setattr(main, "build_agent", lambda settings, **kw: built.append(settings))

    class FakeEngine:
        def __init__(self, factory, settings, out):
            factory(settings, None)
            out("hello")

    async def fake_run(engine):
        return None

    import langchain_chess_cli.uci.engine as engine_module

    monkeypatch.setattr(engine_module, "Engine", FakeEngine)
    monkeypatch.setattr(engine_module, "run", fake_run)
    result = CliRunner().invoke(app, ["uci", "--move-list", "none", "--no-with-eval"])
    assert result.output == "hello\n"
    assert (built[0].move_list, built[0].with_eval) == ("none", False)


def test_help_documents_flags_with_their_settings():
    result = CliRunner().invoke(app, ["play", "--help"], env={"COLUMNS": "200"})
    # CI forces colour, and its codes split the flag names.
    output = re.sub(r"\x1b\[[0-9;]*m", "", result.output)
    assert "The most candidates suggested to the LLM." in output
    assert "langsmith:baseten/zai-org/GLM-5.3-Flash" in output
    assert "--memory" in output


def test_model_kwargs_and_the_prompt_are_flags(monkeypatch):
    built = []
    monkeypatch.setattr(main, "build_agent", lambda settings, **kw: built.append(settings))

    class FakeEngine:
        def __init__(self, factory, settings, out):
            factory(settings, None)

    async def fake_run(engine):
        return None

    import langchain_chess_cli.uci.engine as engine_module

    monkeypatch.setattr(engine_module, "Engine", FakeEngine)
    monkeypatch.setattr(engine_module, "run", fake_run)
    args = [
        "uci",
        "--model-kwargs",
        '{"temperature": 0.2}',
        "--system-prompt",
        "Hi.",
        "--no-show-fen",
    ]
    assert CliRunner().invoke(app, args).exit_code == 0
    assert (built[0].model_kwargs, built[0].system_prompt, built[0].show_fen) == (
        {"temperature": 0.2},
        "Hi.",
        False,
    )
    for bad in ("{not json", '{"base_url": "https://x"}'):
        assert CliRunner().invoke(app, ["uci", "--model-kwargs", bad]).exit_code == 2
