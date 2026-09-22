"""Adapters that let the game graph drive any policy graph the same way.

A `Mover` pairs a compiled policy graph with two pure mappings: board -> that graph's input,
and that graph's output -> `MoveDecision`. The game graph's `policy_move` node calls
`mover.graph.invoke(...)` directly (not through a method) so LangGraph's subgraph detection
finds the policy graph and Studio renders it nested inside the game.
"""

import random
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

import chess
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from jev_chess.graphs.context import PlayContext, hybrid_config, jev_config, llm_config
from jev_chess.policies import (
    HybridPolicy,
    JevPolicy,
    LLMPolicy,
    MoveDecision,
    legal_decision,
    ranking_decision,
)
from jev_chess.policies.hybrid import HybridState
from jev_chess.policies.jev import JevState
from jev_chess.policies.llm import LLMState
from jev_chess.settings import GatewaySettings


@dataclass(frozen=True, slots=True)
class Mover:
    graph: CompiledStateGraph[Any]
    to_input: Callable[[chess.Board, Sequence[str]], Any]
    to_decision: Callable[[dict[str, Any], chess.Board], MoveDecision]


def jev_mover(policy: JevPolicy) -> Mover:
    return Mover(
        graph=policy.graph,
        to_input=lambda board, history: JevState(fen=board.fen(), history=list(history)),
        to_decision=lambda result, board: ranking_decision(result["ranking"], board),
    )


def llm_mover(policy: LLMPolicy) -> Mover:
    return Mover(
        graph=policy.graph,
        to_input=lambda board, history: LLMState(fen=board.fen(), history=list(history)),
        to_decision=lambda result, board: result["decision"],
    )


def hybrid_mover(policy: HybridPolicy) -> Mover:
    return Mover(
        graph=policy.graph,
        to_input=lambda board, history: HybridState(fen=board.fen(), history=list(history)),
        to_decision=lambda result, board: result["decision"],
    )


@dataclass
class RandomState:
    fen: str
    decision: MoveDecision | None = None


def build_random_graph(seed: int = 0) -> CompiledStateGraph[RandomState]:
    """A one-node policy graph so `random` fits the same Mover shape as the real policies."""
    rng = random.Random(seed)

    def pick(state: RandomState) -> dict[str, Any]:
        board = chess.Board(state.fen)
        move = rng.choice(sorted(board.legal_moves, key=lambda m: m.uci()))
        decision = legal_decision(
            {m.uci() for m in board.legal_moves},
            uci=move.uci(),
            source="engine",
            model="random",
            latency_ms=0.0,
            cost_usd=0.0,
        )
        return {"decision": decision}

    graph: StateGraph[RandomState] = StateGraph(RandomState)
    graph.add_node("pick", pick)
    graph.add_edge(START, "pick")
    graph.add_edge("pick", END)
    return graph.compile()


def random_mover(seed: int = 0) -> Mover:
    return Mover(
        graph=build_random_graph(seed),
        to_input=lambda board, _history: RandomState(fen=board.fen()),
        to_decision=lambda result, board: result["decision"],
    )


def mover_for(context: PlayContext, settings: GatewaySettings | None = None) -> Mover:
    """Open the policy the context names. The imperative edge: this is where clients get built."""
    if context.policy == "random":
        return random_mover()
    if context.policy == "jev":
        return jev_mover(JevPolicy.from_settings(settings, jev_config(context)))
    if context.policy == "llm":
        return llm_mover(LLMPolicy.from_settings(settings, llm_config(context)))
    return hybrid_mover(HybridPolicy.from_settings(settings, hybrid_config(context)))
