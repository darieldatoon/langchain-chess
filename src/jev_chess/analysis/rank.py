"""Rank sampled positions with the Jev policy, concurrently."""

import asyncio
from collections.abc import Callable, Iterable

import chess

from jev_chess.analysis.records import JevRecord, PositionRecord, RankedCandidate
from jev_chess.policies import JevPolicy, JevRanking

type Progress = Callable[[JevRecord], None]


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
    )


async def rank_positions(
    records: Iterable[PositionRecord],
    policy: JevPolicy,
    concurrency: int = 8,
    progress: Progress = lambda _: None,
) -> list[JevRecord]:
    gate = asyncio.Semaphore(max(1, concurrency))

    async def one(record: PositionRecord) -> JevRecord:
        async with gate:
            ranking = await policy.arank(chess.Board(record.fen))
        out = to_record(record, ranking, policy.config.style)
        progress(out)
        return out

    return list(await asyncio.gather(*(one(r) for r in records)))
