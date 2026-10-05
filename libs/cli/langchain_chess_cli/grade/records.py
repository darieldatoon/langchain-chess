"""Games read from their traces, and the feedback their grades become. Pure."""

import json
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
"""The review's header, written last: a game is graded once it is there and its parts are whole."""
PART_KEY = "game_review_part"
PART_BYTES = 16 * 1024
"""Each part's budget, under LangSmith's default 20 KiB cap: it stores a bigger value as null."""
STATUS_KEY = "grade_status"
"""The review app's mark on a game it launched a grading job for: `analyzing`, then `failed`."""
FAILED = "failed"
PLY_KEYS = ("move_quality", "cp_loss", "win_pct_loss", "best_move")
GAME_KEYS = ("accuracy_white", "accuracy_black")
SCORE_KEYS = (*PLY_KEYS, *GAME_KEYS)
REVIEW_KEYS = (REVIEW_KEY, PART_KEY)


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


def feedback(
    record: GameRecord,
    grade: GameGrade,
    grader: Grader,
    generation: str,
    part_bytes: int = PART_BYTES,
) -> tuple[Feedback, ...]:
    """Per-move keys on each agent turn's run; the game's on its last run, the review's header last.

    The header is the marker that a game is graded, so a write cut short is redone. `generation`
    ties the header to its parts, so a reader never mixes two gradings.
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
    header, parts = review(record, grade, grader, generation, part_bytes)
    entries += [Feedback(record.last_run, PART_KEY, info, value=part) for part in parts]
    entries.append(Feedback(record.last_run, REVIEW_KEY, info, value=header))
    return tuple(entries)


def size(value: JSONValue) -> int:
    """Bytes as LangSmith measures a feedback value against its cap: compact JSON."""
    return len(json.dumps(value, separators=(",", ":")).encode())


def review(
    record: GameRecord,
    grade: GameGrade,
    grader: Grader,
    generation: str,
    part_bytes: int = PART_BYTES,
) -> tuple[dict[str, JSONValue], list[dict[str, JSONValue]]]:
    """Everything the review app draws: a header, and the plies in parts of at most `part_bytes`.

    Each part carries its plies and the evaluation before each; the header the final one.
    `run_id` saves the app reading every turn.
    """
    evals: list[JSONValue] = [eval_json(e) for e in grade.evals]
    plies: list[JSONValue] = [
        {
            "ply": p.ply,
            "run_id": record.ply_runs[p.ply].id,
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
    ]

    def part(start: int, end: int) -> dict[str, JSONValue]:
        return {
            "version": 2,
            "generation": generation,
            "part": len(parts),
            "from": start,
            "evals": evals[start:end],
            "plies": plies[start:end],
        }

    parts: list[dict[str, JSONValue]] = []
    start = 0
    while start < len(plies):
        end = start + 1
        if size(part(start, end)) > part_bytes:
            msg = f"ply {start}'s grade alone is over {part_bytes} bytes"
            raise ValueError(msg)
        while end < len(plies) and size(part(start, end + 1)) <= part_bytes:
            end += 1
        parts.append(part(start, end))
        start = end
    header: dict[str, JSONValue] = {
        "version": 2,
        "generation": generation,
        "engine": grader.engine,
        "settings": grader.settings,
        "accuracy": {s: None if a is None else round(a, 1) for s, a in grade.accuracy.items()},
        "plies": len(plies),
        "parts": len(parts),
        "final_eval": evals[-1],
    }
    return header, parts


def whole(header: object, parts: Sequence[object]) -> bool:
    """Whether a version 2 header has every one of its parts among `parts`."""
    if not isinstance(header, dict) or header.get("version") != 2:
        return False
    ours = {
        p.get("part")
        for p in parts
        if isinstance(p, dict) and p.get("generation") == header.get("generation")
    }
    count = header.get("parts")
    return isinstance(count, int) and ours >= set(range(count))
