"""The System 1 classifiers' HTTP connection pools: one per process and client library, closed by
the app's lifespan. TypeSafe takes `httpx2` clients, OpenAI Decisions `httpx` ones.

A module of its own, always imported by package name: langgraph loads graph.py from its file
path under a generated module name, so a pool kept there would exist once per copy.
"""

from collections.abc import Callable
from threading import Lock
from typing import Any, Protocol

import httpx
import httpx2

TIMEOUT_S = 15.0


class _Sync(Protocol):
    def close(self) -> None: ...


class _Async(Protocol):
    async def aclose(self) -> None: ...


class ClientPool[S: _Sync, A: _Async]:
    def __init__(self, make: Callable[[], tuple[S, A]]) -> None:
        self._make = make
        self._lock = Lock()
        self._clients: tuple[S, A] | None = None

    def get(self) -> tuple[S, A]:
        """The shared pair, created on first use; the lock keeps concurrent first uses to one."""
        with self._lock:
            if self._clients is None:
                self._clients = self._make()
            return self._clients

    async def aclose(self) -> None:
        """Close the pair if one was made; the next `get` makes a fresh one."""
        with self._lock:
            clients, self._clients = self._clients, None
        if clients is not None:
            client, async_client = clients
            client.close()
            await async_client.aclose()


POOL: ClientPool[Any, Any] = ClientPool(
    lambda: (httpx2.Client(timeout=TIMEOUT_S), httpx2.AsyncClient(timeout=TIMEOUT_S))
)
DECISIONS_POOL: ClientPool[Any, Any] = ClientPool(
    lambda: (httpx.Client(timeout=TIMEOUT_S), httpx.AsyncClient(timeout=TIMEOUT_S))
)
