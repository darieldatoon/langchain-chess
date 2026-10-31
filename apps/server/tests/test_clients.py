from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import httpx2
import pytest

from langchain_chess_server.clients import DECISIONS_POOL, POOL, ClientPool


def pair():
    return httpx2.Client(timeout=1.0), httpx2.AsyncClient(timeout=1.0)


def test_concurrent_first_use_makes_one_pair():
    pool = ClientPool(pair)
    barrier = Barrier(8)

    def first_use():
        barrier.wait()
        return pool.get()

    with ThreadPoolExecutor(8) as executor:
        pairs = list(executor.map(lambda _: first_use(), range(8)))
    assert all(pair is pairs[0] for pair in pairs)


@pytest.mark.parametrize("pool", [POOL, DECISIONS_POOL], ids=["typesafe", "decisions"])
async def test_closing_closes_the_pair_and_the_next_use_makes_a_fresh_one(pool):
    await pool.aclose()
    client, async_client = pool.get()
    await pool.aclose()
    assert client.is_closed
    assert async_client.is_closed
    assert not pool.get()[0].is_closed
    await pool.aclose()
