"""The System 1 classifiers' HTTP connection pool: one per process, closed by the app's lifespan.

A module of its own, always imported by package name: langgraph loads graph.py from its file
path under a generated module name, so a pool kept there would exist once per copy.
"""

from threading import Lock

import httpx2

type Clients = tuple[httpx2.Client, httpx2.AsyncClient]


class ClientPool:
    def __init__(self, timeout: float) -> None:
        self._timeout = timeout
        self._lock = Lock()
        self._clients: Clients | None = None

    def get(self) -> Clients:
        """The shared pair, created on first use; the lock keeps concurrent first uses to one."""
        with self._lock:
            if self._clients is None:
                self._clients = (
                    httpx2.Client(timeout=self._timeout),
                    httpx2.AsyncClient(timeout=self._timeout),
                )
            return self._clients

    async def aclose(self) -> None:
        """Close the pair if one was made; the next `get` makes a fresh one."""
        with self._lock:
            clients, self._clients = self._clients, None
        if clients is not None:
            client, async_client = clients
            client.close()
            await async_client.aclose()


POOL = ClientPool(timeout=15.0)
