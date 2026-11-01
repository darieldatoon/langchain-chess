"""Server settings, via pydantic-settings.

Settings read the shell first and `.env` second. Model credentials are not here: they are the
providers' own env vars (or `LANGSMITH_GATEWAY*`), read by the chat model itself.

A key that is set but empty is an error, not unset. The `.env` template sets
`LANGSMITH_GATEWAY_API_KEY=${LC_GATEWAY_KEY}`, which expands to "" when the shell variable is
missing, and langchain-core would then silently fall back to the tracing key.
"""

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class ServerSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Read only to reject a blank value; the chat model reads the variable itself.
    langsmith_gateway_api_key: SecretStr | None = Field(
        default=None, validation_alias="LANGSMITH_GATEWAY_API_KEY"
    )
    typesafe_api_key: SecretStr | None = Field(default=None, validation_alias="TYPESAFE_API_KEY")
    typesafe_base_url: str | None = Field(default=None, validation_alias="TYPESAFE_BASE_URL")
    # "Sign in with LangSmith" (auth.py). Blank means unset, unlike the keys above: the deploy
    # workflow writes both before the OAuth app exists, and unset only refuses tokens.
    oauth_client_id: str | None = Field(default=None, validation_alias="OAUTH_CLIENT_ID")
    allowed_organization_id: str | None = Field(
        default=None, validation_alias="ALLOWED_ORGANIZATION_ID"
    )

    @field_validator("oauth_client_id", "allowed_organization_id")
    @classmethod
    def _blank_is_unset(cls, value: str | None) -> str | None:
        return None if value is None else value.strip() or None

    @field_validator("langsmith_gateway_api_key", "typesafe_api_key", "typesafe_base_url")
    @classmethod
    def _not_blank(cls, value: SecretStr | str | None) -> SecretStr | str | None:
        text = value.get_secret_value() if isinstance(value, SecretStr) else value
        if text is not None and not text.strip():
            msg = "is set but empty; unset it or give it a value"
            raise ValueError(msg)
        return value

    def typesafe(self) -> tuple[str, str]:
        """(api key, base URL) for System 1; only the policies that run it need them."""
        if self.typesafe_api_key is None or self.typesafe_base_url is None:
            msg = "System 1 needs TYPESAFE_API_KEY and TYPESAFE_BASE_URL"
            raise ValueError(msg)
        return self.typesafe_api_key.get_secret_value(), self.typesafe_base_url
