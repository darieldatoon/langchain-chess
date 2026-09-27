"""Shared by every package's tests: plain help output, no remote tracing outside the live suite."""

import os

import pytest

# Typer reads these at import and forces colour under GITHUB_ACTIONS. Keep above any test import.
os.environ["_TYPER_FORCE_DISABLE_TERMINAL"] = "1"
os.environ["TERMINAL_WIDTH"] = "200"


def pytest_configure(config: pytest.Config) -> None:
    if "live" not in (config.option.markexpr or "").replace("not live", ""):
        os.environ["LANGSMITH_TRACING"] = "false"
