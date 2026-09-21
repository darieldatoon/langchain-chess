"""On-disk records for the offline pipeline, one JSON object per line.

Three files, joined on `id`: positions (sampled), labels (Stockfish), rankings (Jev).
Keeping them separate means re-ranking with a new description style never re-runs the
oracle, and vice versa.
"""

from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

type Phase = Literal["opening", "middlegame", "endgame"]


class PositionRecord(BaseModel):
    id: str
    fen: str
    ply: int
    phase: Phase
    game_id: str
    white: str
    black: str


class LabelMove(BaseModel):
    uci: str
    cp: int | None
    mate: int | None


class OracleLabel(BaseModel):
    id: str
    depth: int
    ranked: list[LabelMove]

    @property
    def best(self) -> LabelMove:
        return self.ranked[0]


class RankedCandidate(BaseModel):
    uci: str
    probability: float


class JevRecord(BaseModel):
    id: str
    model: str
    style: str
    candidates: list[RankedCandidate]
    confidence: float
    input_tokens: int
    output_tokens: int
    latency_ms: float
    eval_score: float | None = None
    needs_calculation: float | None = None
    tactics_present: float | None = None


def write_jsonl(path: Path, records: Iterable[BaseModel]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(record.model_dump_json())
            handle.write("\n")
            count += 1
    return count


def read_jsonl[ModelT: BaseModel](path: Path, model: type[ModelT]) -> Iterator[ModelT]:
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                yield model.model_validate_json(line)
