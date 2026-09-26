"""Games read from their traces, and the feedback their grades become. Pure."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, cast

from langchain_chess.engine import Grader
from langchain_chess.grading import GameGrade, eval_json, first_runs, positions
from langchain_chess.grading import Position as GradedPosition
from langchain_chess.state import JSONValue, Outcome

GRADER = "lcchess grade"
REVIEW_KEY = "game_review"
PLY_KEYS = ("move_quality", "cp_loss", "win_pct_loss", "best_move")
GAME_KEYS = ("accuracy_white", "accuracy_black", REVIEW_KEY)
KEYS = (*PLY_KEYS, *GAME_KEYS)


@dataclass(frozen=True, slots=True)
class RootRun:
    id: str
    project_id: str
    start_time: datetime
    outputs: Mapping[str, Any] | None = field(default=None, repr=False)


@dataclass(frozen=True, slots=True)
class GameRecord:
    thread_id: str
    start_fen: str
    moves: tuple[str, ...]
    outcome: Outcome | None
    turn_ids: tuple[str | None, ...]
    """Per ply; None for a move that came in as input."""
    ply_runs: tuple[RootRun, ...]
    """Per ply, the root run that played it (or took it as input)."""
    last_run: RootRun
    runs: tuple[RootRun, ...]
    positions: tuple[GradedPosition, ...] = field(repr=False)


def _plies(outputs: Mapping[str, Any] | None) -> list[Mapping[str, Any]] | None:
    plies = (outputs or {}).get("plies")
    return plies if isinstance(plies, list) else None


def game_record(thread_id: str, runs: Sequence[RootRun]) -> GameRecord | None:
    """None when no run carries a game with a move in it."""
    games = sorted((r for r in runs if _plies(r.outputs) is not None), key=lambda r: r.start_time)
    if not games:
        return None
    last = max(games, key=lambda r: (len(_plies(r.outputs) or []), r.start_time))
    outputs = cast("Mapping[str, Any]", last.outputs)
    plies = cast("list[Mapping[str, Any]]", _plies(outputs))
    if not plies:
        return None
    moves = tuple(str(m) for m in outputs["moves"])
    by_id = {r.id: r for r in games}
    return GameRecord(
        thread_id=thread_id,
        start_fen=str(outputs["start_fen"]),
        moves=moves,
        outcome=outputs.get("outcome"),
        turn_ids=tuple(p.get("turn_id") for p in plies),
        ply_runs=tuple(
            by_id[i] for i in first_runs([(r.id, len(_plies(r.outputs) or [])) for r in games])
        ),
        last_run=last,
        runs=tuple(games),
        positions=positions(str(outputs["start_fen"]), moves, outputs.get("outcome")),
    )


@dataclass(frozen=True, slots=True)
class Feedback:
    run: RootRun
    key: str
    source_info: dict[str, JSONValue]
    score: float | None = None
    value: str | dict[str, JSONValue] | None = None


def source_info(grader: Grader, **extra: JSONValue) -> dict[str, JSONValue]:
    return {
        "grader": GRADER,
        "engine": grader.engine,
        "settings": grader.settings,
        "fingerprint": grader.fingerprint,
        **extra,
    }


def feedback(record: GameRecord, grade: GameGrade, grader: Grader) -> tuple[Feedback, ...]:
    """Per-move keys on each agent turn's run; the game's on its last run, the review last.

    The review is the marker that a game is graded, so a write cut short is redone.
    """
    entries: list[Feedback] = []
    for ply, turn_id in zip(grade.plies, record.turn_ids, strict=True):
        if turn_id is None:
            continue
        run, info = record.ply_runs[ply.ply], source_info(grader, ply=ply.ply)
        entries += [
            Feedback(run, "move_quality", info, value=ply.quality),
            Feedback(run, "cp_loss", info, score=ply.cp_loss),
            Feedback(run, "win_pct_loss", info, score=round(ply.win_pct_loss, 2)),
            Feedback(run, "best_move", info, value=ply.best_move),
        ]
    info = source_info(grader)
    for side in ("white", "black"):
        accuracy = grade.accuracy[side]
        if accuracy is not None:
            entries.append(
                Feedback(record.last_run, f"accuracy_{side}", info, score=round(accuracy, 1))
            )
    entries.append(Feedback(record.last_run, REVIEW_KEY, info, value=review(grade, grader)))
    return tuple(entries)


def review(grade: GameGrade, grader: Grader) -> dict[str, JSONValue]:
    """Everything the review app draws, in one value."""
    return {
        "version": 1,
        "engine": grader.engine,
        "settings": grader.settings,
        "accuracy": {s: None if a is None else round(a, 1) for s, a in grade.accuracy.items()},
        "evals": [eval_json(e) for e in grade.evals],
        "plies": [
            {
                "ply": p.ply,
                "side": p.side,
                "uci": p.played,
                "best_move": p.best_move,
                "quality": p.quality,
                "cp_loss": p.cp_loss,
                "win_pct_loss": round(p.win_pct_loss, 2),
                "accuracy": round(p.accuracy, 1),
                "lines": [{"eval": eval_json(line.eval), "pv": list(line.pv)} for line in p.lines],
            }
            for p in grade.plies
        ],
    }
