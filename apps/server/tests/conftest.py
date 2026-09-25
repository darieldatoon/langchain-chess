import pytest

GOOD = {
    "LANGSMITH_GATEWAY": "true",
    "LANGSMITH_GATEWAY_API_KEY": "lsv2_test",
    "TYPESAFE_BASE_URL": "https://gateway.smith.langchain.com",
    "TYPESAFE_API_KEY": "lsv2_test",
}


@pytest.fixture
def env(monkeypatch: pytest.MonkeyPatch, tmp_path) -> pytest.MonkeyPatch:
    """The gateway settings, isolated from the shell and from the repo's `.env`."""
    for name in (*GOOD, "LANGSMITH_GATEWAY_URL", "LC_GATEWAY_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.chdir(tmp_path)
    for name, value in GOOD.items():
        monkeypatch.setenv(name, value)
    return monkeypatch
