"""Play one game between two Players and record every ply.

A Player turns a board into a MoveDecision. Engines, Jev, LLMs, and the hybrid all fit
that shape, so the runner never knows who is playing. Records are pydantic models so they
serialise to JSONL and replay: any ply's FEN plus the remaining moves rebuilds the game.
"""

from collections.abc import Callable, Sequence
from typing import Literal, Protocol, cast

import chess
from pydantic import BaseModel

from jev_chess.core.position import side_of
from jev_chess.core.types import Side
from jev_chess.policies.types import MoveDecision, MoveSource

type Result = Literal["1-0", "0-1", "1/2-1/2"]
type Termination = Literal[
    "checkmate",
    "stalemate",
    "insufficient_material",
    "seventyfive_moves",
    "fivefold_repetition",
    "fifty_moves",
    "threefold_repetition",
    "max_plies",
    "adjudication_decisive",
    "adjudication_max_plies",
]


class Adjudication(Protocol):
    """Optional early-ending rules; see runner.adjudication for the Stockfish one."""

    def after_ply(self, board: chess.Board) -> tuple[str, str] | None: ...

    def at_max_plies(self, board: chess.Board) -> tuple[str, str]: ...


class Player(Protocol):
    @property
    def name(self) -> str: ...

    def decide(self, board: chess.Board, game_id: str, ply: int) -> MoveDecision: ...


class PlyRecord(BaseModel):
    game_id: str
    ply: int
    side: Side
    player: str
    fen_before: str
    uci: str
    san: str
    source: MoveSource
    model: str
    latency_ms: float
    input_tokens: int
    output_tokens: int
    reasoning_tokens: int
    cost_usd: float | None
    escalated: bool
    illegal_attempts: int
    jev_confidence: float | None
    jev_margin: float | None
    jev_top_uci: str | None


class SideTotals(BaseModel):
    player: str
    plies: int = 0
    latency_ms: float = 0.0
    input_tokens: int = 0
    output_tokens: int = 0
    reasoning_tokens: int = 0
    cost_usd: float = 0.0
    cost_known: bool = True
    escalations: int = 0
    illegal_attempts: int = 0
    fallbacks: int = 0

    def add(self, decision: MoveDecision) -> None:
        self.plies += 1
        self.latency_ms += decision.latency_ms
        self.input_tokens += decision.input_tokens
        self.output_tokens += decision.output_tokens
        self.reasoning_tokens += decision.reasoning_tokens
        if decision.cost_usd is None:
            self.cost_known = False
        else:
            self.cost_usd += decision.cost_usd
        self.escalations += int(decision.escalated)
        self.illegal_attempts += decision.illegal_attempts
        self.fallbacks += int(decision.source.startswith("fallback"))


class GameRecord(BaseModel):
    game_id: str
    white: str
    black: str
    opening: str
    opening_plies: int
    result: Result
    termination: Termination
    plies: int
    final_fen: str
    pgn: str
    white_totals: SideTotals
    black_totals: SideTotals


type OnPly = Callable[[PlyRecord], None]


def _termination(board: chess.Board) -> tuple[Result, Termination] | None:
    outcome = board.outcome(claim_draw=True)
    if outcome is None:
        return None
    result = outcome.result()
    assert result in ("1-0", "0-1", "1/2-1/2")
    return result, cast("Termination", outcome.termination.name.lower())


def play_game(
    white: Player,
    black: Player,
    game_id: str,
    opening_name: str = "start",
    opening_uci: Sequence[str] = (),
    max_plies: int = 200,
    on_ply: OnPly = lambda _: None,
    adjudicator: Adjudication | None = None,
) -> GameRecord:
    board = chess.Board()
    for uci in opening_uci:
        board.push_uci(uci)
    totals = {
        chess.WHITE: SideTotals(player=white.name),
        chess.BLACK: SideTotals(player=black.name),
    }
    ended = _termination(board)
    while ended is None and len(board.move_stack) < max_plies:
        player = white if board.turn == chess.WHITE else black
        ply = len(board.move_stack) + 1
        decision = player.decide(board.copy(), game_id, ply)
        move = chess.Move.from_uci(decision.uci)
        if move not in board.legal_moves:
            msg = f"{player.name} returned illegal move {decision.uci} at ply {ply}"
            raise ValueError(msg)
        record = PlyRecord(
            game_id=game_id,
            ply=ply,
            side=side_of(board.turn),
            player=player.name,
            fen_before=board.fen(),
            uci=decision.uci,
            san=board.san(move),
            source=decision.source,
            model=decision.model,
            latency_ms=decision.latency_ms,
            input_tokens=decision.input_tokens,
            output_tokens=decision.output_tokens,
            reasoning_tokens=decision.reasoning_tokens,
            cost_usd=decision.cost_usd,
            escalated=decision.escalated,
            illegal_attempts=decision.illegal_attempts,
            jev_confidence=decision.jev_confidence,
            jev_margin=decision.jev_margin,
            jev_top_uci=decision.jev_top_uci,
        )
        totals[board.turn].add(decision)
        board.push(move)
        on_ply(record)
        ended = _termination(board)
        if ended is None and adjudicator is not None:
            early = adjudicator.after_ply(board)
            if early is not None:
                ended = cast("tuple[Result, Termination]", early)
    if ended is None:
        ended = (
            cast("tuple[Result, Termination]", adjudicator.at_max_plies(board))
            if adjudicator is not None
            else ("1/2-1/2", "max_plies")
        )
    result, termination = ended
    return GameRecord(
        game_id=game_id,
        white=white.name,
        black=black.name,
        opening=opening_name,
        opening_plies=len(opening_uci),
        result=result,
        termination=termination,
        plies=len(board.move_stack),
        final_fen=board.fen(),
        pgn=board.root().variation_san(board.move_stack),
        white_totals=totals[chess.WHITE],
        black_totals=totals[chess.BLACK],
    )
