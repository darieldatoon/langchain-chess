"""Grade every recorded ply with the oracle: centipawn loss of the move actually played.

Phase 2 could only grade moves that appeared in Stockfish's multipv list. Here we evaluate
the position before the move and the position after it, both from the mover's point of
view, so every move gets a number. For hybrid escalations we also grade Jev's top move, so
"did the LLM's override help?" is answerable from the records.
"""

from collections.abc import Callable, Iterable, Sequence
from concurrent.futures import ThreadPoolExecutor
from typing import Literal

import chess
from pydantic import BaseModel

from jev_chess.runner.adjudication import Evaluator
from jev_chess.runner.game import PlyRecord

type MoveClass = Literal["best", "good", "inaccuracy", "mistake", "blunder"]

# Centipawn-loss bands, the common Lichess-style thresholds.
INACCURACY_CP = 50
MISTAKE_CP = 100
BLUNDER_CP = 300
CP_LOSS_CAP = 1000


class GradeRecord(BaseModel):
    game_id: str
    ply: int
    player: str
    source: str
    escalated: bool
    best_uci: str
    eval_before_cp: int
    eval_after_cp: int
    cp_loss: int
    move_class: MoveClass
    jev_top_cp_loss: int | None = None
    override: bool = False
    override_gain_cp: int | None = None


def classify(cp_loss: int) -> MoveClass:
    if cp_loss <= 0:
        return "best"
    if cp_loss < INACCURACY_CP:
        return "good"
    if cp_loss < MISTAKE_CP:
        return "inaccuracy"
    if cp_loss < BLUNDER_CP:
        return "mistake"
    return "blunder"


def _mover_eval_after(oracle: Evaluator, board: chess.Board, uci: str) -> int:
    """Evaluation after `uci`, from the mover's point of view."""
    after = board.copy(stack=False)
    after.push_uci(uci)
    if after.is_checkmate():
        return 100_000
    if after.is_game_over(claim_draw=True):
        return 0
    return -oracle.evaluate(after, multipv=1).best.score_cp


def grade_one(oracle: Evaluator, ply: PlyRecord) -> GradeRecord:
    board = chess.Board(ply.fen_before)
    before = oracle.evaluate(board, multipv=1)
    after = _mover_eval_after(oracle, board, ply.uci)
    loss = min(CP_LOSS_CAP, max(0, before.best.score_cp - after))
    record = GradeRecord(
        game_id=ply.game_id,
        ply=ply.ply,
        player=ply.player,
        source=ply.source,
        escalated=ply.escalated,
        best_uci=before.best.uci,
        eval_before_cp=before.best.score_cp,
        eval_after_cp=after,
        cp_loss=loss,
        move_class=classify(loss),
    )
    if ply.escalated and ply.jev_top_uci is not None:
        jev_after = _mover_eval_after(oracle, board, ply.jev_top_uci)
        jev_loss = min(CP_LOSS_CAP, max(0, before.best.score_cp - jev_after))
        override = ply.jev_top_uci != ply.uci
        record = record.model_copy(
            update={
                "jev_top_cp_loss": jev_loss,
                "override": override,
                "override_gain_cp": (jev_loss - loss) if override else None,
            }
        )
    return record


type OracleFactory = Callable[[], Evaluator]
type Progress = Callable[[GradeRecord], None]


def _grade_chunk(
    open_oracle: OracleFactory, chunk: Sequence[PlyRecord], progress: Progress
) -> list[GradeRecord]:
    out: list[GradeRecord] = []
    oracle = open_oracle()
    try:
        for ply in chunk:
            grade = grade_one(oracle, ply)
            progress(grade)
            out.append(grade)
    finally:
        oracle.close()
    return out


def grade_plies(
    plies: Iterable[PlyRecord],
    open_oracle: OracleFactory,
    workers: int = 4,
    progress: Progress = lambda _: None,
) -> list[GradeRecord]:
    items = list(plies)
    if not items:
        return []
    workers = max(1, min(workers, len(items)))
    chunks = [items[i::workers] for i in range(workers)]
    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(lambda c: _grade_chunk(open_oracle, c, progress), chunks))
    by_key = {(g.game_id, g.ply): g for chunk in results for g in chunk}
    return [by_key[(p.game_id, p.ply)] for p in items]
