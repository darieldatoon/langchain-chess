import pytest
from pydantic import ValidationError

from langchain_chess_server.settings import GatewaySettings


def test_gateway_settings_happy_path(env):
    settings = GatewaySettings()
    assert settings.langsmith_gateway is True
    assert settings.langsmith_gateway_api_key.get_secret_value() == "lsv2_test"
    assert "lsv2_test" not in repr(settings)
    assert settings.typesafe_base_url == "https://gateway.smith.langchain.com"
    assert settings.gateway_url == "https://gateway.smith.langchain.com"


@pytest.mark.parametrize(
    ("name", "value", "message"),
    [
        ("LANGSMITH_GATEWAY", "false", "LANGSMITH_GATEWAY must be true"),
        ("LANGSMITH_GATEWAY_API_KEY", "", "LANGSMITH_GATEWAY_API_KEY\n  Field required"),
        ("TYPESAFE_BASE_URL", "https://api.typesafe.ai", "must point at the gateway root"),
        ("TYPESAFE_API_KEY", "", "TYPESAFE_API_KEY\n  Field required"),
    ],
)
def test_gateway_settings_fail_fast(env, name, value, message):
    env.setenv(name, value)
    with pytest.raises(ValidationError, match=message):
        GatewaySettings()


def test_env_file_is_read(env, tmp_path):
    env.delenv("TYPESAFE_API_KEY")
    (tmp_path / ".env").write_text("TYPESAFE_API_KEY=from-file\n")
    assert GatewaySettings().typesafe_api_key.get_secret_value() == "from-file"
