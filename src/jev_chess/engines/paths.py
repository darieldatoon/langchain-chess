"""Locate engine binaries from settings or PATH."""

import shutil


class EngineNotFoundError(FileNotFoundError):
    pass


def resolve_binary(name: str, configured: str | None) -> str:
    """Prefer the configured path; otherwise search PATH. Raise with an actionable message."""
    if configured:
        found = shutil.which(configured) or (configured if _is_executable(configured) else None)
    else:
        found = shutil.which(name)
    if found is None:
        hint = f"set {name.upper()}_PATH in .env or `brew install {name}`"
        msg = f"{name} binary not found ({hint})"
        raise EngineNotFoundError(msg)
    return found


def _is_executable(path: str) -> bool:
    import os

    return os.path.isfile(path) and os.access(path, os.X_OK)
