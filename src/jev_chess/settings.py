"""Environment loading for the imperative shell.

Pure over a mapping so tests never touch os.environ. Gateway settings fail fast when the
gateway key resolved empty: `${LC_GATEWAY_KEY}` expands to "" if the shell variable is
missing, and langchain-core would then silently fall back to the tracing key and route
model calls to the wrong org.
"""

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

GATEWAY_HOST = "gateway.smith.langchain.com"


class SettingsError(ValueError):
    """Configuration that would misroute traffic or fail later in a confusing place."""


@dataclass(frozen=True, slots=True)
class EngineSettings:
    stockfish_path: str | None
    lc0_path: str | None
    maia_weights_dir: Path


@dataclass(frozen=True, slots=True)
class GatewaySettings:
    gateway_api_key: str
    typesafe_api_key: str
    typesafe_base_url: str


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _non_empty(env: Mapping[str, str], name: str) -> str | None:
    value = env.get(name, "").strip()
    return value or None


def engine_settings(env: Mapping[str, str]) -> EngineSettings:
    return EngineSettings(
        stockfish_path=_non_empty(env, "STOCKFISH_PATH"),
        lc0_path=_non_empty(env, "LC0_PATH"),
        maia_weights_dir=Path(_non_empty(env, "MAIA_WEIGHTS_DIR") or "engines/maia"),
    )


def gateway_settings(env: Mapping[str, str]) -> GatewaySettings:
    if not _truthy(env.get("LANGSMITH_GATEWAY")):
        msg = "LANGSMITH_GATEWAY must be true; all model calls go through the LLM Gateway"
        raise SettingsError(msg)
    gateway_key = _non_empty(env, "LANGSMITH_GATEWAY_API_KEY")
    if gateway_key is None:
        msg = "LANGSMITH_GATEWAY_API_KEY is empty; is LC_GATEWAY_KEY exported in your shell?"
        raise SettingsError(msg)
    base_url = _non_empty(env, "TYPESAFE_BASE_URL")
    if base_url is None or GATEWAY_HOST not in base_url:
        msg = "TYPESAFE_BASE_URL must point at the LLM Gateway's /typesafe path"
        raise SettingsError(msg)
    typesafe_key = _non_empty(env, "TYPESAFE_API_KEY")
    if typesafe_key is None:
        msg = "TYPESAFE_API_KEY is empty; set it to ${LC_GATEWAY_KEY} for gateway routing"
        raise SettingsError(msg)
    return GatewaySettings(
        gateway_api_key=gateway_key, typesafe_api_key=typesafe_key, typesafe_base_url=base_url
    )


def load_env(dotenv_path: Path | None = None) -> Mapping[str, str]:
    """Load .env into the process (without overriding the shell) and return the environment."""
    load_dotenv(dotenv_path, override=False)
    return dict(os.environ)
