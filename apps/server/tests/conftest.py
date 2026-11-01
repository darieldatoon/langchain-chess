import json
import socket
import subprocess
import sys
import time
from collections.abc import Callable, Iterator, Mapping
from contextlib import AbstractContextManager, contextmanager
from pathlib import Path

import httpx
import pytest

GOOD = {
    "LANGSMITH_GATEWAY": "true",
    "LANGSMITH_GATEWAY_API_KEY": "lsv2_test",
    "TYPESAFE_BASE_URL": "https://gateway.smith.langchain.com",
    "TYPESAFE_API_KEY": "lsv2_test",
}

REPO = Path(__file__).resolve().parents[3]
LANGGRAPH = Path(sys.executable).parent / "langgraph"
STARTUP_S = 90


@pytest.fixture
def env(monkeypatch: pytest.MonkeyPatch, tmp_path) -> pytest.MonkeyPatch:
    """The server settings, isolated from the shell and from the repo's `.env`."""
    for name in (*GOOD, "LC_GATEWAY_KEY", "OAUTH_CLIENT_ID", "ALLOWED_ORGANIZATION_ID"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.chdir(tmp_path)
    for name, value in GOOD.items():
        monkeypatch.setenv(name, value)
    return monkeypatch


def _absolute(spec: str) -> str:
    return str(REPO / spec.removeprefix("./"))


def _config_in(workdir: Path, env_file: Path | None, graphs: Mapping[str, str] | None) -> Path:
    """The repo's langgraph.json with absolute paths: the server resolves them against its
    working directory, and it keeps its local state (`.langgraph_api/`) there too."""
    config = json.loads((REPO / "langgraph.json").read_text())
    specs = graphs if graphs is not None else config["graphs"]
    config["graphs"] = {name: _absolute(spec) for name, spec in specs.items()}
    config["http"]["app"] = _absolute(config["http"]["app"])
    config["auth"]["path"] = _absolute(config["auth"]["path"])
    config["env"] = str(env_file) if env_file is not None else _absolute(config["env"])
    config["source"]["root"] = str(REPO)
    path = workdir / "langgraph.json"
    path.write_text(json.dumps(config))
    return path


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


@contextmanager
def _langgraph_dev(
    workdir: Path,
    *,
    env_file: Path | None = None,
    environ: Mapping[str, str] | None = None,
    graphs: Mapping[str, str] | None = None,
) -> Iterator[str]:
    port = _free_port()
    log_path = workdir / "server.log"
    command = [
        str(LANGGRAPH),
        "dev",
        "--config",
        str(_config_in(workdir, env_file, graphs)),
        "--port",
        str(port),
        "--no-browser",
        "--no-reload",
    ]
    with log_path.open("w") as log:
        process = subprocess.Popen(
            command, cwd=workdir, stdout=log, stderr=subprocess.STDOUT, env=environ
        )
        url = f"http://127.0.0.1:{port}"
        try:
            deadline = time.monotonic() + STARTUP_S
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    pytest.fail(f"langgraph dev exited:\n{log_path.read_text()}")
                try:
                    if httpx.get(f"{url}/ok", timeout=1).status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                time.sleep(0.2)
            else:
                pytest.fail(f"langgraph dev didn't start:\n{log_path.read_text()}")
            yield url
        finally:
            process.terminate()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()


@pytest.fixture(scope="session")
def langgraph_dev() -> Callable[..., AbstractContextManager[str]]:
    """Starts `langgraph dev` on the repo's langgraph.json from `workdir` and yields its URL.

    Run it from a temp directory, so its local state never mixes test threads into a
    developer's own dev server. `env_file` replaces langgraph.json's `.env`, and `graphs` its
    graphs.
    """
    return _langgraph_dev
