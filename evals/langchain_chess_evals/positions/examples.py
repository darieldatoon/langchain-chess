"""A labelled position: its reference evals, and the same row as JSONL and as a LangSmith
example. Pure.

A JSONL row is the example itself (`inputs`, `outputs`, `metadata`, `split`) plus its row id, so
`upload` needs no other file.
"""

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, cast

import chess

from langchain_chess.grading import Analysis, Cp, Eval, Mate, cp_loss, eval_json
from langchain_chess.rules import side
from langchain_chess.state import JSONValue
from langchain_chess_evals.positions.sampling import SPLITS, Sampled, Split

TACTIC_GAP_CP = 150
_ID_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "https://github.com/darieldatoon/langchain-chess")


class LabelError(ValueError):
    """The engine's lines don't cover every legal move."""


def eval_from_json(data: Mapping[str, Any]) -> Eval:
    if "cp" in data:
        return Cp(int(data["cp"]))
    return Mate(int(data["mate"]), data["winner"])


@dataclass(frozen=True, slots=True)
class Reference:
    evals: Mapping[str, Eval]
    """Every legal move, from White's side."""
    ranked: tuple[str, ...] = ()
    """The engine's order, best first; defaults to the order of `evals`."""

    def __post_init__(self) -> None:
        if not self.ranked:
            object.__setattr__(self, "ranked", tuple(self.evals))
        if sorted(self.ranked) != sorted(self.evals):
            msg = "ranked must list every move in evals, once"
            raise ValueError(msg)

    @property
    def best(self) -> str:
        return self.ranked[0]

    @property
    def top3(self) -> tuple[str, ...]:
        return self.ranked[:3]

    def json(self) -> dict[str, JSONValue]:
        return {
            "evals": {uci: eval_json(self.evals[uci]) for uci in self.ranked},
            "ranked": list(self.ranked),
            "best": self.best,
            "top3": list(self.top3),
        }

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> "Reference":
        # The order comes from `ranked`, never from `evals`: LangSmith returns object keys sorted.
        evals = {uci: eval_from_json(e) for uci, e in data["evals"].items()}
        return cls(evals, tuple(data["ranked"]))


def reference_from(analysis: Analysis, legal: Sequence[str]) -> Reference:
    """One engine line per legal move, as MultiPV over every move returns them."""
    evals: dict[str, Eval] = {}
    for line in analysis.lines:
        if line.pv:
            evals.setdefault(line.pv[0], line.eval)
    missing = set(legal) - set(evals)
    if missing or len(evals) != len(legal):
        msg = f"engine lines cover {len(evals)} moves, missing {sorted(missing)}"
        raise LabelError(msg)
    return Reference(evals)


def is_tactic(board: chess.Board, reference: Reference) -> bool:
    """The best move captures or checks, or beats the second best by `TACTIC_GAP_CP`."""
    best = chess.Move.from_uci(reference.best)
    if board.is_capture(best) or board.gives_check(best):
        return True
    if len(reference.ranked) < 2:
        return False
    evals = reference.evals
    gap = cp_loss(evals[reference.best], evals[reference.ranked[1]], side(board.turn))
    return gap >= TACTIC_GAP_CP


@dataclass(frozen=True, slots=True)
class Row:
    id: str
    split: Split
    start_fen: str
    moves: tuple[str, ...]
    legal: tuple[str, ...]
    reference: Reference
    metadata: Mapping[str, JSONValue]

    @property
    def board(self) -> chess.Board:
        board = chess.Board(self.start_fen)
        for uci in self.moves:
            board.push_uci(uci)
        return board

    @property
    def example_id(self) -> str:
        """Stable across uploads, so a re-upload updates rows rather than duplicating them."""
        return str(uuid.uuid5(_ID_NAMESPACE, f"positions/{self.id}"))

    def inputs(self) -> dict[str, JSONValue]:
        """`RankRequest`'s shape, less the seed."""
        return {"start_fen": self.start_fen, "moves": list(self.moves), "legal": list(self.legal)}

    def json(self) -> dict[str, JSONValue]:
        return {
            "id": self.id,
            "split": self.split,
            "inputs": self.inputs(),
            "outputs": self.reference.json(),
            "metadata": dict(self.metadata),
        }

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> "Row":
        split = data["split"]
        if split not in SPLITS:
            msg = f"unknown split {split!r} in row {data['id']}"
            raise ValueError(msg)
        inputs = data["inputs"]
        return cls(
            id=data["id"],
            split=cast("Split", split),
            start_fen=inputs["start_fen"],
            moves=tuple(inputs["moves"]),
            legal=tuple(inputs["legal"]),
            reference=Reference.from_json(data["outputs"]),
            metadata=data["metadata"],
        )

    def example(self) -> dict[str, Any]:
        """For `Client.create_examples` and `update_examples`."""
        return {
            "id": self.example_id,
            "inputs": self.inputs(),
            "outputs": self.reference.json(),
            "metadata": {"row_id": self.id, **self.metadata},
            "split": self.split,
        }


def row_of(sampled: Sampled, reference: Reference) -> Row:
    p = sampled.position
    board = chess.Board(p.fen)
    return Row(
        id=p.id,
        split=sampled.split,
        start_fen=chess.STARTING_FEN,
        moves=p.moves,
        legal=p.legal,
        reference=reference,
        metadata={
            "game_url": p.game.url,
            "month": p.game.month,
            "white_elo": p.game.white_elo,
            "black_elo": p.game.black_elo,
            "rating": p.rating,
            "band": p.band,
            "time_control": p.game.time_control,
            "time_class": p.game.time_class,
            "ply": p.ply,
            "phase": p.phase,
            "legal_count": len(p.legal),
            "tactic": is_tactic(board, reference),
            "played_move": p.played,
        },
    )
