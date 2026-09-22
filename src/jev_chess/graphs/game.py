"""Human vs policy, one thread per game.

One run is one round: apply the human's move, let the policy answer, stop. The next move is
another run on the same thread, from Studio or the UI. If the human plays Black the first run
carries no move and the policy opens.

State is plain JSON (FEN, SAN, UCI lists, per-ply telemetry dicts) so the checkpointer never
sees a custom type and the browser can render it as-is. The policy graph runs as a subgraph.
"""

from dataclasses import dataclass, field
from typing import Any, Literal, TypedDict, cast

import chess
from langchain_core.runnables import RunnableConfig
from langchain_core.runnables.config import merge_configs
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph_sdk.runtime import ServerRuntime

from jev_chess.core.position import side_of
from jev_chess.core.types import Side
from jev_chess.graphs.context import PlayContext, player_spec, resolve_context
from jev_chess.graphs.movers import Mover, mover_for
from jev_chess.policies import MoveDecision

type Status = Literal["playing", "checkmate", "stalemate", "draw", "max_plies"]
type GameGraph = CompiledStateGraph["GameState", "PlayContext", "GameInput", "GameState"]
type Result = Literal["1-0", "0-1", "1/2-1/2"]


class TopView(TypedDict):
    uci: str
    san: str
    probability: float


class PlyView(TypedDict, total=False):
    ply: int
    side: Side
    san: str
    uci: str
    source: str
    model: str
    latency_ms: float
    cost_usd: float | None
    input_tokens: int
    output_tokens: int
    reasoning_tokens: int
    escalated: bool
    illegal_attempts: int
    jev_confidence: float | None
    jev_margin: float | None
    jev_top: list[TopView]
    raw_reply: str | None


@dataclass
class GameInput:
    move: str | None = None


@dataclass
class GameState:
    """Plain JSON values only: the checkpointer and the browser both read this as-is."""

    move: str | None = None
    fen: str = chess.STARTING_FEN
    history: list[str] = field(default_factory=list)
    moves: list[str] = field(default_factory=list)
    plies: list[PlyView] = field(default_factory=list)
    status: Status = "playing"
    result: Result | None = None
    error: str | None = None
    player: str = ""
    human_side: Side = "white"


def board_of(state: GameState) -> chess.Board:
    return chess.Board(state.fen)


def parse_move(board: chess.Board, text: str) -> chess.Move | None:
    """Accept UCI or SAN; None when the text is not a legal move here."""
    for parser in (board.parse_uci, board.parse_san):
        try:
            return parser(text)
        except ValueError:
            continue
    return None


def outcome_of(board: chess.Board, plies: int, max_plies: int) -> tuple[Status, Result | None]:
    outcome = board.outcome(claim_draw=True)
    if outcome is not None:
        result = cast("Result", outcome.result())
        if outcome.termination == chess.Termination.CHECKMATE:
            return "checkmate", result
        if outcome.termination == chess.Termination.STALEMATE:
            return "stalemate", result
        return "draw", result
    if plies >= max_plies:
        return "max_plies", "1/2-1/2"
    return "playing", None


def decision_view(decision: MoveDecision, board: chess.Board) -> PlyView:
    """Everything the UI shows about a policy move; SAN is added for Jev's candidates."""
    top = [
        TopView(uci=c.uci, san=board.san(chess.Move.from_uci(c.uci)), probability=c.probability)
        for c in decision.jev_top_k or ()
    ]
    return PlyView(
        source=decision.source,
        model=decision.model,
        latency_ms=decision.latency_ms,
        cost_usd=decision.cost_usd,
        input_tokens=decision.input_tokens,
        output_tokens=decision.output_tokens,
        reasoning_tokens=decision.reasoning_tokens,
        escalated=decision.escalated,
        illegal_attempts=decision.illegal_attempts,
        jev_confidence=decision.jev_confidence,
        jev_margin=decision.jev_margin,
        jev_top=top,
        raw_reply=decision.raw_reply,
    )


def push(
    state: GameState, board: chess.Board, move: chess.Move, view: PlyView, max_plies: int
) -> dict[str, Any]:
    """Apply `move` and return the state update; pure over its inputs."""
    ply = len(state.moves) + 1
    san = board.san(move)
    record = PlyView(ply=ply, side=side_of(board.turn), san=san, uci=move.uci(), **view)
    board.push(move)
    status, result = outcome_of(board, ply, max_plies)
    return {
        "fen": board.fen(),
        "history": [*state.history, san],
        "moves": [*state.moves, move.uci()],
        "plies": [*state.plies, record],
        "status": status,
        "result": result,
    }


def _policy_run_config(config: RunnableConfig, label: str, ply: int) -> RunnableConfig:
    thread_id = (config.get("configurable") or {}).get("thread_id", "local")
    return merge_configs(
        config,
        {
            "run_name": f"{label} ply {ply}",
            "metadata": {"game_id": str(thread_id), "ply": ply, "player": label},
            "tags": ["jev-chess", label.split(":")[0]],
        },
    )


def build_game_graph(context: PlayContext, mover: Mover) -> GameGraph:
    label = player_spec(context).name

    def apply_human(state: GameState) -> dict[str, Any]:
        board = board_of(state)
        base: dict[str, Any] = {
            "move": None,
            "error": None,
            "player": label,
            "human_side": context.human_side,
        }
        text = (state.move or "").strip()
        if not text:
            return base
        if state.status != "playing":
            return {**base, "error": f"The game is over ({state.status})."}
        if side_of(board.turn) != context.human_side:
            return {**base, "error": "It is not your move."}
        move = parse_move(board, text)
        if move is None:
            return {**base, "error": f"{text} is not a legal move here."}
        human = PlyView(source="human", model="human", latency_ms=0.0, cost_usd=0.0)
        return {**base, **push(state, board, move, human, context.max_plies)}

    def route(state: GameState) -> str:
        if state.error or state.status != "playing":
            return END
        return "policy_move" if side_of(board_of(state).turn) != context.human_side else END

    def policy_move(state: GameState, config: RunnableConfig) -> dict[str, Any]:
        board = board_of(state)
        ply = len(state.moves) + 1
        run_config = _policy_run_config(config, label, ply)
        try:
            result = mover.graph.invoke(mover.to_input(board, state.history), config=run_config)
        except Exception as exc:  # provider errors must not strand the thread
            # The human's move is already applied; an empty submit retries the opponent.
            return {"error": f"{label} failed to move: {exc}"}
        decision = mover.to_decision(result, board)
        move = chess.Move.from_uci(decision.uci)
        return push(state, board, move, decision_view(decision, board), context.max_plies)

    graph: StateGraph[GameState, PlayContext, GameInput, GameState] = StateGraph(
        GameState, context_schema=PlayContext, input_schema=GameInput
    )
    graph.add_node("apply_human", apply_human)
    graph.add_node("policy_move", policy_move)
    graph.add_edge(START, "apply_human")
    graph.add_conditional_edges("apply_human", route, {"policy_move": "policy_move", END: END})
    graph.add_edge("policy_move", END)
    return graph.compile()


def make_game_graph(config: RunnableConfig, runtime: ServerRuntime[Any]) -> GameGraph:
    """`langgraph.json` entry point: knobs from the assistant context or `configurable`."""
    context = resolve_context(PlayContext, config, runtime)
    return build_game_graph(context, mover_for(context))
