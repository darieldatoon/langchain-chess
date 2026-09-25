"""Shared by every package's tests: no remote tracing outside the live suite."""

import os

import pytest


def pytest_configure(config: pytest.Config) -> None:
    if "live" not in (config.option.markexpr or "").replace("not live", ""):
        os.environ["LANGSMITH_TRACING"] = "false"
