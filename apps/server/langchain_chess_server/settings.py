"""Gateway settings and the org rules the app enforces, via pydantic-settings.

Settings read the shell first and `.env` second. `env_ignore_empty` matters: the `.env`
template sets `LANGSMITH_GATEWAY_API_KEY=${LC_GATEWAY_KEY}`, which expands to "" when the shell
variable is missing. Treating "" as unset makes that a validation error, instead of
langchain-core silently falling back to the tracing key and routing calls to the wrong org.
"""

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

GATEWAY_HOST = "gateway.smith.langchain.com"


class GatewaySettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_ignore_empty=True,
        extra="ignore",
    )

    langsmith_gateway: bool = Field(validation_alias="LANGSMITH_GATEWAY")
    langsmith_gateway_api_key: SecretStr = Field(validation_alias="LANGSMITH_GATEWAY_API_KEY")
    gateway_url: str = Field(
        default=f"https://{GATEWAY_HOST}", validation_alias="LANGSMITH_GATEWAY_URL"
    )
    typesafe_api_key: SecretStr = Field(validation_alias="TYPESAFE_API_KEY")
    typesafe_base_url: str = Field(validation_alias="TYPESAFE_BASE_URL")

    @field_validator("langsmith_gateway")
    @classmethod
    def _gateway_must_be_on(cls, on: bool) -> bool:
        if not on:
            msg = "LANGSMITH_GATEWAY must be true; all model calls go through the LLM Gateway"
            raise ValueError(msg)
        return on

    @field_validator("typesafe_base_url")
    @classmethod
    def _base_url_must_be_gateway(cls, url: str) -> str:
        if GATEWAY_HOST not in url:
            msg = f"TYPESAFE_BASE_URL must point at the gateway root https://{GATEWAY_HOST}"
            msg += f", got {url!r}"
            raise ValueError(msg)
        return url
