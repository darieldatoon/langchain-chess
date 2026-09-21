"""Label positions with Stockfish's top moves, in parallel across engine processes."""

from collections.abc import Callable, Iterable, Sequence
from concurrent.futures import ThreadPoolExecutor

import chess

from jev_chess.analysis.records import LabelMove, OracleLabel, PositionRecord
from jev_chess.engines import Oracle

type OracleFactory = Callable[[], Oracle]
type Progress = Callable[[OracleLabel], None]


def label_one(oracle: Oracle, record: PositionRecord, depth: int) -> OracleLabel:
    evaluation = oracle.evaluate(chess.Board(record.fen))
    return OracleLabel(
        id=record.id,
        depth=depth,
        ranked=[LabelMove(uci=m.uci, cp=m.cp, mate=m.mate) for m in evaluation.ranked],
    )


def _label_chunk(
    open_oracle: OracleFactory, chunk: Sequence[PositionRecord], depth: int, progress: Progress
) -> list[OracleLabel]:
    out: list[OracleLabel] = []
    with open_oracle() as oracle:
        for record in chunk:
            label = label_one(oracle, record, depth)
            progress(label)
            out.append(label)
    return out


def label_positions(
    records: Iterable[PositionRecord],
    open_oracle: OracleFactory,
    depth: int,
    workers: int = 4,
    progress: Progress = lambda _: None,
) -> list[OracleLabel]:
    """One Stockfish process per worker; results come back in input order."""
    items = list(records)
    if not items:
        return []
    workers = max(1, min(workers, len(items)))
    chunks = [items[i::workers] for i in range(workers)]
    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(lambda c: _label_chunk(open_oracle, c, depth, progress), chunks))
    by_id = {label.id: label for chunk in results for label in chunk}
    return [by_id[r.id] for r in items]
