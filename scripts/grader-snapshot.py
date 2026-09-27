"""Build the review app's grader snapshot from docker/grader.Dockerfile, in a LangSmith sandbox.

Run through `mise run review:snapshot`. It needs LANGSMITH_API_KEY, and LANGSMITH_WORKSPACE_ID
when the key reaches more than one workspace. Rebuilding moves the name to the new snapshot.
"""

import functools
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from langsmith.sandbox import SandboxClient

NAME = "langchain-chess-grader"
PACKAGES = ("langchain-chess", "langchain-chess-systemone", "langchain-chess-cli")
ROOT = Path(__file__).resolve().parent.parent


def stage(context: Path) -> None:
    """The Dockerfile, the workspace packages as wheels, and their locked requirements."""
    shutil.copy(ROOT / "docker" / "grader.Dockerfile", context / "Dockerfile")
    for package in PACKAGES:
        subprocess.run(
            ["uv", "build", "--package", package, "--wheel", "-q", "-o", context / "wheels"],
            cwd=ROOT,
            check=True,
        )
    subprocess.run(
        [
            "uv",
            "export",
            "--package",
            "langchain-chess-cli",
            "--frozen",
            "--no-dev",
            "--no-emit-workspace",
            "--no-header",
            "-q",
            "-o",
            context / "requirements.txt",
        ],
        cwd=ROOT,
        check=True,
    )


def main() -> None:
    workspace = os.environ.get("LANGSMITH_WORKSPACE_ID")
    # Creating the builder sandbox and uploading the context outlast the default 10 s.
    client = SandboxClient(timeout=120, headers={"X-Tenant-Id": workspace} if workspace else None)
    # The SDK tags a Dockerfile build with its random image tag, which the app's bare name
    # (name:latest) never resolves; there is no re-tag endpoint, so tag it at capture.
    client.capture_snapshot = functools.partial(client.capture_snapshot, tag="latest")
    with tempfile.TemporaryDirectory() as tmp:
        context = Path(tmp)
        stage(context)
        snapshot = client.create_snapshot_from_dockerfile(
            NAME,
            context / "Dockerfile",
            context=context,
            vcpus=2,
            timeout=1200,
            on_build_log=lambda line: print(line, end="", file=sys.stderr),
        )
    print(f"snapshot {NAME}: {snapshot.id} ({snapshot.status})")


if __name__ == "__main__":
    main()
