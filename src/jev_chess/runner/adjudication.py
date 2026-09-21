"""End decided games early with the oracle, and score `max_plies` endings by eval.

Two rules, both pure over an oracle evaluation:

- decisive: the side to move is ahead by `decisive_cp` or has a forced mate for
  `decisive_plies` consecutive plies -> the game is scored for that side.
- max plies: when the ply cap is hit, an advantage of at least `max_plies_cp` is a win for
  the side ahead, otherwise a draw. Scoring these as draws (phase 3) inflated draw counts
  for weak players who could not convert.
"""

from dataclasses import dataclass, field
from typing import Protocol

import chess

from jev_chess.engines.stockfish import Evaluation

type AdjudicatedResult = tuple[str, str]  # (result, termination)


class Evaluator(Protocol):
    """The slice of Oracle that adjudication and grading use, so tests can script it."""

    def evaluate(self, board: chess.Board, multipv: int | None = None) -> Evaluation: ...

    def close(self) -> None: ...


@dataclass(frozen=True, slots=True)
class AdjudicationConfig:
    decisive_cp: int = 1000
    decisive_plies: int = 6
    max_plies_cp: int = 300
    min_ply: int = 20


def white_cp(board: chess.Board, evaluation: Evaluation) -> int:
    score = evaluation.best.score_cp
    return score if board.turn == chess.WHITE else -score


def _result_for(cp_white: int) -> str:
    return "1-0" if cp_white > 0 else "0-1"


@dataclass
class Adjudicator:
    """Tracks consecutive decisive evaluations across a game. One per game."""

    oracle: Evaluator
    config: AdjudicationConfig = field(default_factory=AdjudicationConfig)
    streak_sign: int = 0
    streak: int = 0

    def after_ply(self, board: chess.Board) -> AdjudicatedResult | None:
        if len(board.move_stack) < self.config.min_ply:
            return None
        cp = white_cp(board, self.oracle.evaluate(board, multipv=1))
        sign = 1 if cp >= self.config.decisive_cp else -1 if cp <= -self.config.decisive_cp else 0
        if sign == 0 or sign != self.streak_sign:
            self.streak_sign, self.streak = sign, 1 if sign else 0
        else:
            self.streak += 1
        if sign and self.streak >= self.config.decisive_plies:
            return _result_for(cp), "adjudication_decisive"
        return None

    def at_max_plies(self, board: chess.Board) -> AdjudicatedResult:
        cp = white_cp(board, self.oracle.evaluate(board, multipv=1))
        if abs(cp) >= self.config.max_plies_cp:
            return _result_for(cp), "adjudication_max_plies"
        return "1/2-1/2", "max_plies"
