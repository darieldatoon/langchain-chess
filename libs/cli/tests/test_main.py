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


def test_play_refuses_an_effort_the_model_takes_none_of(monkeypatch):
    monkeypatch.setenv("LANGSMITH_GATEWAY", "false")
    haiku = "langsmith:anthropic/claude-haiku-4-5-20251001"
    args = ["play", "--policy", "llm", "--model", haiku, "--reasoning-effort", "high"]
    result = CliRunner().invoke(app, args)
    assert result.exit_code == 2
    assert "doesn't take a reasoning effort" in result.output


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
    output = CliRunner().invoke(app, ["play", "--help"]).output
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


def test_a_config_file_with_flags_and_resets_over_it(monkeypatch, tmp_path):
    built = []
    monkeypatch.setattr(main, "build_agent", lambda settings, **kw: built.append(settings))
    import langchain_chess_cli.tui.app as tui

    monkeypatch.setattr(tui.ChessApp, "run", lambda self: None)
    config = tmp_path / "opponent.json"
    config.write_text('{"version": 2, "policy": "llm", "k": 3, "top_p": 0.5, "memory": true}')
    args = ["play", "--config", str(config), "--k", "4", "--reset", "top_p", "--no-memory"]
    result = CliRunner().invoke(app, args)
    assert result.exit_code == 0, result.output
    assert (built[0].policy, built[0].k, built[0].top_p, built[0].memory) == ("llm", 4, None, False)
    config.write_text('{"k": 3}')
    assert CliRunner().invoke(app, ["play", "--config", str(config)]).exit_code == 2
    config.write_text("{")
    assert CliRunner().invoke(app, ["play", "--config", str(config)]).exit_code == 2


def test_uci_refuses_a_seed_it_cannot_declare():
    result = CliRunner().invoke(
        app, ["uci", "--policy", "systemone", "--seed", "-1"], input="quit\n"
    )
    assert result.exit_code == 2
