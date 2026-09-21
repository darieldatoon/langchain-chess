from pathlib import Path

import pytest

from jev_chess.settings import SettingsError, engine_settings, gateway_settings, load_env

GOOD = {
    "LANGSMITH_GATEWAY": "true",
    "LANGSMITH_GATEWAY_API_KEY": "lsv2_test",
    "TYPESAFE_BASE_URL": "https://gateway.smith.langchain.com/typesafe",
    "TYPESAFE_API_KEY": "lsv2_test",
}


def test_gateway_settings_happy_path() -> None:
    s = gateway_settings(GOOD)
    assert s.gateway_api_key == "lsv2_test"
    assert s.typesafe_base_url.endswith("/typesafe")


@pytest.mark.parametrize(
    ("override", "message"),
    [
        ({"LANGSMITH_GATEWAY": "false"}, "LANGSMITH_GATEWAY must be true"),
        ({"LANGSMITH_GATEWAY_API_KEY": ""}, "LC_GATEWAY_KEY exported"),
        ({"LANGSMITH_GATEWAY_API_KEY": "   "}, "LC_GATEWAY_KEY exported"),
        ({"TYPESAFE_BASE_URL": "https://api.typesafe.ai"}, "must point at the LLM Gateway"),
        ({"TYPESAFE_BASE_URL": ""}, "must point at the LLM Gateway"),
        ({"TYPESAFE_API_KEY": ""}, "TYPESAFE_API_KEY is empty"),
    ],
)
def test_gateway_settings_fail_fast(override: dict[str, str], message: str) -> None:
    with pytest.raises(SettingsError, match=message):
        gateway_settings({**GOOD, **override})


def test_engine_settings_defaults_and_overrides() -> None:
    default = engine_settings({})
    assert default.stockfish_path is None
    assert default.lc0_path is None
    assert default.maia_weights_dir == Path("engines/maia")
    custom = engine_settings(
        {"STOCKFISH_PATH": "/opt/sf", "LC0_PATH": " /opt/lc0 ", "MAIA_WEIGHTS_DIR": "/w"}
    )
    assert (custom.stockfish_path, custom.lc0_path, custom.maia_weights_dir) == (
        "/opt/sf",
        "/opt/lc0",
        Path("/w"),
    )


def test_load_env_reads_dotenv_without_overriding_shell(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    dotenv = tmp_path / ".env"
    dotenv.write_text("JEV_TEST_A=from_file\nJEV_TEST_B=from_file\n")
    monkeypatch.setenv("JEV_TEST_B", "from_shell")
    monkeypatch.delenv("JEV_TEST_A", raising=False)
    env = load_env(dotenv)
    assert env["JEV_TEST_A"] == "from_file"
    assert env["JEV_TEST_B"] == "from_shell"
