"""Rank sampled positions with the Jev policy, concurrently.

The gateway rate-limits bursts (429 with a retry-after hint) and the classifier does not
retry on its own, so `arank` calls are wrapped in bounded exponential backoff.
"""

import asyncio
from collections.abc import Awaitable, Callable, Iterable

import chess
from langchain_typesafe.client import TypeSafeRateLimitError

from jev_chess.analysis.records import JevRecord, PositionRecord, RankedCandidate
from jev_chess.policies import JevPolicy, JevRanking

type Progress = Callable[[JevRecord], None]
type Sleep = Callable[[float], Awaitable[None]]

DEFAULT_CONCURRENCY = 4
MAX_ATTEMPTS = 6
BASE_BACKOFF_S = 1.0
MAX_BACKOFF_S = 30.0


def backoff_seconds(attempt: int, retry_after_ms: float | None) -> float:
    """Server hint when present, otherwise exponential from BASE, capped at MAX."""
    if retry_after_ms is not None:
        return min(MAX_BACKOFF_S, retry_after_ms / 1000)
    return min(MAX_BACKOFF_S, BASE_BACKOFF_S * 2**attempt)


async def rank_with_retry(
    policy: JevPolicy,
    board: chess.Board,
    sleep: Sleep = asyncio.sleep,
    max_attempts: int = MAX_ATTEMPTS,
) -> JevRanking:
    for attempt in range(max_attempts):
        try:
            return await policy.arank(board)
        except TypeSafeRateLimitError as exc:
            if attempt == max_attempts - 1:
                raise
            await sleep(backoff_seconds(attempt, exc.retry_after_ms))
    raise AssertionError("unreachable")  # pragma: no cover


def to_record(record: PositionRecord, ranking: JevRanking, style: str) -> JevRecord:
    return JevRecord(
        id=record.id,
        model=ranking.model,
        style=style,
        candidates=[
            RankedCandidate(uci=c.uci, probability=c.probability) for c in ranking.candidates
        ],
        confidence=ranking.confidence,
        input_tokens=ranking.input_tokens,
        output_tokens=ranking.output_tokens,
        latency_ms=ranking.latency_ms,
        eval_score=ranking.eval_score,
        needs_calculation=ranking.needs_calculation,
        tactics_present=ranking.tactics_present,
    )


async def rank_positions(
    records: Iterable[PositionRecord],
    policy: JevPolicy,
    concurrency: int = DEFAULT_CONCURRENCY,
    progress: Progress = lambda _: None,
    sleep: Sleep = asyncio.sleep,
) -> list[JevRecord]:
    gate = asyncio.Semaphore(max(1, concurrency))

    async def one(record: PositionRecord) -> JevRecord:
        async with gate:
            ranking = await rank_with_retry(policy, chess.Board(record.fen), sleep)
        out = to_record(record, ranking, policy.config.style)
        progress(out)
        return out

    return list(await asyncio.gather(*(one(r) for r in records)))
