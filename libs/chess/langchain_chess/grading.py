"""Engine grades for a game: move quality, loss and accuracy, computed as Lichess does. Pure.

Sources, so the constants can be checked against them:
- winning chances: scalachess `core/src/main/scala/eval.scala`
- judgements: lila `modules/tree/src/main/Advice.scala`
- accuracy: lila `modules/analyse/src/main/AccuracyPercent.scala`
"""

import math
import statistics
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

import chess

from langchain_chess.rules import side
from langchain_chess.state import JSONValue, Outcome, Side

type Quality = Literal["best", "good", "inaccuracy", "mistake", "blunder"]
type Judgement = Literal["inaccuracy", "mistake", "blunder"]

CP_CEILING = 1000
_JUDGEMENTS: tuple[tuple[float, Judgement], ...] = (
    (0.3, "blunder"),
    (0.2, "mistake"),
    (0.1, "inaccuracy"),
)


@dataclass(frozen=True, slots=True)
class Cp:
    value: int
    """Centipawns from White's side."""


@dataclass(frozen=True, slots=True)
class Mate:
    moves: int
    """Moves to mate; 0 once the loser is mated."""
    winner: Side


type Eval = Cp | Mate


@dataclass(frozen=True, slots=True)
class Line:
    eval: Eval
    pv: tuple[str, ...]
    """UCI, from the analysed position."""


@dataclass(frozen=True, slots=True)
class Analysis:
    lines: tuple[Line, ...]
    """Best first; never empty."""

    @property
    def eval(self) -> Eval:
        return self.lines[0].eval

    @property
    def best_move(self) -> str | None:
        pv = self.lines[0].pv
        return pv[0] if pv else None


@dataclass(frozen=True, slots=True)
class Position:
    fen: str
    settled: Eval | None
    """Known without an engine: the game ended here."""


@dataclass(frozen=True, slots=True)
class PlyGrade:
    ply: int
    side: Side
    played: str
    best_move: str | None
    quality: Quality
    cp_loss: int
    win_pct_loss: float
    accuracy: float
    lines: tuple[Line, ...]
    """The engine's lines before the move."""


@dataclass(frozen=True, slots=True)
class GameGrade:
    evals: tuple[Eval, ...]
    """One per position, the start included."""
    plies: tuple[PlyGrade, ...]
    accuracy: Mapping[Side, float | None]
    """None for a side that never moved."""


def positions(
    start_fen: str, moves: Sequence[str], outcome: Outcome | None
) -> tuple[Position, ...]:
    """Every position of the game. Only the last can be settled: a game ends there."""
    board = chess.Board(start_fen)
    fens = [board.fen()]
    for uci in moves:
        board.push_uci(uci)
        fens.append(board.fen())
    final = _settled(board, outcome)
    return (
        *(Position(fen, None) for fen in fens[:-1]),
        Position(fens[-1], final),
    )


def _settled(board: chess.Board, outcome: Outcome | None) -> Eval | None:
    if board.is_checkmate():
        return Mate(0, side(not board.turn))
    # A claimed draw ends the game in a position the engine would still score.
    if (outcome is not None and outcome["kind"] == "draw") or board.outcome() is not None:
        return Cp(0)
    return None


def engine_fens(games: Iterable[Sequence[Position]]) -> tuple[str, ...]:
    """The positions an engine must evaluate, each once, in first-seen order."""
    return tuple(dict.fromkeys(p.fen for game in games for p in game if p.settled is None))


def _signed_cp(e: Eval, pov: Side) -> int:
    if isinstance(e, Mate):
        return CP_CEILING if e.winner == pov else -CP_CEILING
    cp = max(-CP_CEILING, min(CP_CEILING, e.value))
    return cp if pov == "white" else -cp


def _mate_sign(e: Eval, pov: Side) -> int | None:
    if isinstance(e, Cp):
        return None
    return 1 if e.winner == pov else -1


def winning_chances(e: Eval, pov: Side) -> float:
    """In [-1, 1] for `pov`."""
    return 2 / (1 + math.exp(-0.00368208 * _signed_cp(e, pov))) - 1


def win_percent(e: Eval, pov: Side) -> float:
    return 50 + 50 * winning_chances(e, pov)


def judge(before: Eval, after: Eval, mover: Side) -> Judgement | None:
    was, now = _mate_sign(before, mover), _mate_sign(after, mover)
    if was is None and now == -1:
        return _by_cp(-_signed_cp(before, mover))
    if was == 1 and now != 1:
        return _by_cp(0 if now is not None else _signed_cp(after, mover))
    if was is not None or now is not None:
        return None
    drop = winning_chances(before, mover) - winning_chances(after, mover)
    return next((j for threshold, j in _JUDGEMENTS if drop >= threshold), None)


def _by_cp(cp: int) -> Judgement:
    """A mate created (cp before, negated) or lost (cp after): how bad it was otherwise."""
    if cp > 999:
        return "inaccuracy"
    if cp > 700:
        return "mistake"
    return "blunder"


def move_accuracy(win_before: float, win_after: float) -> float:
    """Win percents for the mover. The `+ 1` is lila's uncertainty bonus."""
    if win_after >= win_before:
        return 100.0
    raw = 103.1668100711649 * math.exp(-0.04354415386753951 * (win_before - win_after))
    return max(0.0, min(100.0, raw - 3.166924740191411 + 1))


def game_accuracy(
    start: Side, evals: Sequence[Eval], accuracies: Sequence[float]
) -> dict[Side, float | None]:
    """Per side: the mean of a volatility-weighted mean and a harmonic mean of move accuracy."""
    wins = [win_percent(e, "white") for e in evals]
    size = max(2, min(8, len(accuracies) // 10))
    head = [wins[:size]] * (min(size, len(wins)) - 2)
    windows = head + [wins[i : i + size] for i in range(max(1, len(wins) - size + 1))]
    weights = [max(0.5, min(12.0, statistics.pstdev(w))) for w in windows]
    by_side: dict[Side, list[tuple[float, float]]] = {"white": [], "black": []}
    mover = start
    for accuracy, weight in zip(accuracies, weights, strict=False):
        by_side[mover].append((accuracy, weight))
        mover = "black" if mover == "white" else "white"
    return {s: _combine(pairs) for s, pairs in by_side.items()}


def _combine(pairs: Sequence[tuple[float, float]]) -> float | None:
    if not pairs:
        return None
    weighted = sum(a * w for a, w in pairs) / sum(w for _, w in pairs)
    harmonic = len(pairs) / sum(1 / max(1.0, a) for a, _ in pairs)
    return (weighted + harmonic) / 2


def grade_game(
    game: Sequence[Position], moves: Sequence[str], analyses: Mapping[str, Analysis]
) -> GameGrade:
    """`analyses` must hold every unsettled position of `game`."""
    evals = tuple(p.settled or analyses[p.fen].eval for p in game)
    start: Side = "white" if chess.Board(game[0].fen).turn == chess.WHITE else "black"
    plies: list[PlyGrade] = []
    mover = start
    for i, played in enumerate(moves):
        analysis = analyses[game[i].fen]
        before, after = evals[i], evals[i + 1]
        win_before, win_after = win_percent(before, mover), win_percent(after, mover)
        best = analysis.best_move
        plies.append(
            PlyGrade(
                ply=i,
                side=mover,
                played=played,
                best_move=best,
                quality="best" if played == best else (judge(before, after, mover) or "good"),
                cp_loss=max(0, _signed_cp(before, mover) - _signed_cp(after, mover)),
                win_pct_loss=max(0.0, win_before - win_after),
                accuracy=move_accuracy(win_before, win_after),
                lines=analysis.lines,
            )
        )
        mover = "black" if mover == "white" else "white"
    return GameGrade(
        evals=evals,
        plies=tuple(plies),
        accuracy=game_accuracy(start, evals, [p.accuracy for p in plies]),
    )


def first_runs(ply_counts: Sequence[tuple[str, int]]) -> tuple[str, ...]:
    """For each ply, the first run (in start order) whose record holds it."""
    owners: list[str] = []
    for run_id, count in ply_counts:
        owners.extend([run_id] * max(0, count - len(owners)))
    return tuple(owners)


def eval_json(e: Eval) -> dict[str, JSONValue]:
    if isinstance(e, Cp):
        return {"cp": e.value}
    return {"mate": e.moves, "winner": e.winner}
