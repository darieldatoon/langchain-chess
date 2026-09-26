"""Row scores for one System 1 ranking against the engine's labels. Pure.

After a tournament only finalists come back, so a move knocked out in the heats counts as a
miss for recall@k; `finalist_recall` and `finalist_top3` measure what the heats lose.
"""

from collections.abc import Mapping
from typing import Any

import chess

from langchain_chess.grading import CP_CEILING, cp_loss, win_pct_loss
from langchain_chess.rules import side
from langchain_chess_evals.positions.examples import Reference

RECALL_AT = (1, 3, 5, 8)
ROW_METRICS: tuple[str, ...] = (
    *(f"recall@{k}" for k in RECALL_AT),
    "top3_in_top5",
    "human_match@1",
    "cp_loss",
    "win_pct_loss",
    "finalist_recall",
    "finalist_top3",
    "error",
    "requests",
    "latency_ms",
    "input_tokens",
)

type Scores = dict[str, float | None]
"""None where a score doesn't apply: `finalist_*` without a tournament, losses without a move."""


def _mover(inputs: Mapping[str, Any]) -> bool:
    board = chess.Board(inputs["start_fen"])
    for uci in inputs["moves"]:
        board.push_uci(uci)
    return board.turn


def row_scores(
    inputs: Mapping[str, Any],
    outputs: Mapping[str, Any],
    reference: Reference,
    played_move: str,
) -> Scores:
    ranked = [r["uci"] for r in outputs["ranked"]]
    top = ranked[0] if ranked else None
    finalists = outputs["finalists"]
    mover = side(_mover(inputs))
    evals = reference.evals
    best = evals[reference.best]
    scores: Scores = {f"recall@{k}": float(reference.best in ranked[:k]) for k in RECALL_AT}
    scores |= {
        "top3_in_top5": float(any(m in ranked[:5] for m in reference.top3)),
        "human_match@1": float(top == played_move),
        "cp_loss": float(min(CP_CEILING, cp_loss(best, evals[top], mover))) if top else None,
        "win_pct_loss": win_pct_loss(best, evals[top], mover) if top else None,
        "finalist_recall": float(reference.best in finalists) if finalists else None,
        "finalist_top3": (
            float(any(m in finalists for m in reference.top3)) if finalists else None
        ),
        "error": float(outputs["error"] is not None),
        "requests": float(outputs["requests"]),
        "latency_ms": float(outputs["latency_ms"]),
        "input_tokens": (
            float(outputs["input_tokens"]) if outputs["input_tokens"] is not None else None
        ),
    }
    return scores
