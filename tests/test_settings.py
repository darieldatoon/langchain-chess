from pathlib import Path

import pytest
from pydantic import ValidationError

from jev_chess.settings import EngineSettings, GatewaySettings

GOOD = {
    "LANGSMITH_GATEWAY": "true",
    "LANGSMITH_GATEWAY_API_KEY": "lsv2_test",
    "TYPESAFE_BASE_URL": "https://gateway.smith.langchain.com/typesafe",
    "TYPESAFE_API_KEY": "lsv2_test",
}


@pytest.fixture
def env(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    for name in (*GOOD, "STOCKFISH_PATH", "LC0_PATH", "MAIA_WEIGHTS_DIR", "LC_GATEWAY_KEY"):
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


def test_gateway_settings_happy_path(env: pytest.MonkeyPatch) -> None:
    for k, v in GOOD.items():
        env.setenv(k, v)
    s = GatewaySettings(_env_file=None)
    assert s.langsmith_gateway is True
    assert s.langsmith_gateway_api_key.get_secret_value() == "lsv2_test"
    assert "lsv2_test" not in repr(s)
    assert s.typesafe_base_url.endswith("/typesafe")


@pytest.mark.parametrize(
    ("override", "message"),
    [
        ({"LANGSMITH_GATEWAY": "false"}, "LANGSMITH_GATEWAY must be true"),
        ({"LANGSMITH_GATEWAY_API_KEY": ""}, "LANGSMITH_GATEWAY_API_KEY\n  Field required"),
        ({"TYPESAFE_BASE_URL": "https://api.typesafe.ai"}, "must point at gateway.smith"),
        ({"TYPESAFE_API_KEY": ""}, "TYPESAFE_API_KEY\n  Field required"),
    ],
)
def test_gateway_settings_fail_fast(
    env: pytest.MonkeyPatch, override: dict[str, str], message: str
) -> None:
    for k, v in {**GOOD, **override}.items():
        env.setenv(k, v)
    with pytest.raises(ValidationError, match=message):
        GatewaySettings(_env_file=None)


def test_engine_settings_defaults_and_empty_is_unset(env: pytest.MonkeyPatch) -> None:
    env.setenv("STOCKFISH_PATH", "")
    s = EngineSettings(_env_file=None)
    assert s.stockfish_path is None
    assert s.lc0_path is None
    assert s.maia_weights_dir == Path("engines/maia")


def test_engine_settings_from_env(env: pytest.MonkeyPatch) -> None:
    env.setenv("STOCKFISH_PATH", "/opt/sf")
    env.setenv("LC0_PATH", "/opt/lc0")
    env.setenv("MAIA_WEIGHTS_DIR", "/w")
    s = EngineSettings(_env_file=None)
    assert (s.stockfish_path, s.lc0_path, s.maia_weights_dir) == ("/opt/sf", "/opt/lc0", Path("/w"))


def test_dotenv_interpolates_shell_variables(env: pytest.MonkeyPatch, tmp_path: Path) -> None:
    dotenv = tmp_path / ".env"
    dotenv.write_text(
        "LANGSMITH_GATEWAY=true\n"
        "LANGSMITH_GATEWAY_API_KEY=${LC_GATEWAY_KEY}\n"
        "TYPESAFE_API_KEY=${LC_GATEWAY_KEY}\n"
        "TYPESAFE_BASE_URL=https://gateway.smith.langchain.com/typesafe\n"
    )
    env.setenv("LC_GATEWAY_KEY", "lsv2_from_shell")
    s = GatewaySettings(_env_file=dotenv)
    assert s.typesafe_api_key.get_secret_value() == "lsv2_from_shell"


def test_dotenv_missing_shell_variable_is_a_hard_error(
    env: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    dotenv = tmp_path / ".env"
    dotenv.write_text(
        "LANGSMITH_GATEWAY=true\n"
        "LANGSMITH_GATEWAY_API_KEY=${LC_GATEWAY_KEY}\n"
        "TYPESAFE_API_KEY=x\n"
        "TYPESAFE_BASE_URL=https://gateway.smith.langchain.com/typesafe\n"
    )
    with pytest.raises(ValidationError, match="LANGSMITH_GATEWAY_API_KEY"):
        GatewaySettings(_env_file=dotenv)


def test_shell_wins_over_dotenv(env: pytest.MonkeyPatch, tmp_path: Path) -> None:
    dotenv = tmp_path / ".env"
    dotenv.write_text("STOCKFISH_PATH=/from/file\n")
    env.setenv("STOCKFISH_PATH", "/from/shell")
    assert EngineSettings(_env_file=dotenv).stockfish_path == "/from/shell"
