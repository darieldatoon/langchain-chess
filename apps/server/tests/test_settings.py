import pytest
from pydantic import ValidationError

from langchain_chess_server.settings import ServerSettings


def test_settings_happy_path(env):
    settings = ServerSettings()
    assert "lsv2_test" not in repr(settings)
    assert settings.typesafe() == ("lsv2_test", "https://gateway.smith.langchain.com")


def test_nothing_is_required(env):
    for name in ("LANGSMITH_GATEWAY", "LANGSMITH_GATEWAY_API_KEY", "TYPESAFE_API_KEY"):
        env.delenv(name)
    settings = ServerSettings()
    with pytest.raises(ValueError, match="System 1 needs"):
        settings.typesafe()


@pytest.mark.parametrize(
    "name", ["LANGSMITH_GATEWAY_API_KEY", "TYPESAFE_API_KEY", "TYPESAFE_BASE_URL"]
)
def test_a_blank_value_fails_fast(env, name):
    env.setenv(name, "")
    with pytest.raises(ValidationError, match=f"{name}\n  Value error, is set but empty"):
        ServerSettings()


def test_env_file_is_read(env, tmp_path):
    env.delenv("TYPESAFE_API_KEY")
    (tmp_path / ".env").write_text("TYPESAFE_API_KEY=from-file\n")
    assert ServerSettings().typesafe()[0] == "from-file"
