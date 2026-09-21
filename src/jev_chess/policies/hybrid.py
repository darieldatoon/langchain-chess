"""The System 1 + System 2 hybrid: Jev ranks, a gate decides, an LLM chooses from a shortlist.

Graph: rank_jev -> gate -> (play_jev | shortlist -> ask_llm -> decide).

One knob sweeps the whole design space. With `threshold=0.0` the gate always holds and this
is Jev alone; with `threshold=1.0` it never holds and every move goes to the LLM over Jev's
top-k (the pure pruner); values between are the experiment. The gate signal is Jev's
top-1 minus top-2 probability margin by default, because phase 2.5 measured it as the
sharpest of the calibrated signals, with Choice confidence as the alternative.

Whenever the LLM is consulted we also record what Jev would have played, so phase 5 can ask
"did the LLM override Jev, and was the override better?" from the records alone.
"""

from dataclasses import dataclass, field
from typing import Any, Literal, cast

import chess
from langchain_core.runnables import RunnableConfig, RunnableLambda
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from jev_chess.policies.jev import JevConfig, JevPolicy
from jev_chess.policies.llm import LLMConfig, LLMPolicy
from jev_chess.policies.pricing import cost_usd
from jev_chess.policies.types import Candidate, JevRanking, MoveDecision, legal_decision

type GateSignal = Literal["margin", "confidence"]


@dataclass(frozen=True, slots=True)
class HybridConfig:
    jev: JevConfig = field(default_factory=JevConfig)
    llm: LLMConfig = field(default_factory=LLMConfig)
    k: int = 5
    top_p: float | None = None
    gate: GateSignal = "margin"
    threshold: float = 0.9

    def __post_init__(self) -> None:
        if not 1 <= self.k <= 255:
            msg = f"k must be within 1..255 (Jev Choice cap), got {self.k}"
            raise ValueError(msg)
        if not 0.0 <= self.threshold <= 1.0:
            msg = f"threshold must be within 0..1, got {self.threshold}"
            raise ValueError(msg)
        if self.top_p is not None and not 0.0 < self.top_p <= 1.0:
            msg = f"top_p must be within (0, 1], got {self.top_p}"
            raise ValueError(msg)

    @property
    def label(self) -> str:
        shortlist = f"k{self.k}" if self.top_p is None else f"p{self.top_p:g}"
        return f"hybrid:{self.llm.label}:{shortlist}:t{self.threshold:g}:{self.gate}"


def gate_value(ranking: JevRanking, gate: GateSignal) -> float:
    return ranking.margin if gate == "margin" else ranking.confidence


def shortlist(ranking: JevRanking, config: HybridConfig) -> tuple[Candidate, ...]:
    """Top-k, or the smallest prefix reaching `top_p` probability mass (capped at k)."""
    top = ranking.top_k(config.k)
    if config.top_p is None:
        return top
    mass = 0.0
    for index, candidate in enumerate(top, start=1):
        mass += candidate.probability
        if mass >= config.top_p:
            return top[:index]
    return top


@dataclass
class HybridState:
    fen: str
    ranking: JevRanking | None = None
    gate_value: float = 0.0
    candidates: list[str] = field(default_factory=list)
    llm_decision: MoveDecision | None = None
    decision: MoveDecision | None = None


def build_graph(
    jev: JevPolicy, llm: LLMPolicy, hybrid: HybridConfig
) -> CompiledStateGraph[HybridState]:
    # Node parameters named `config` receive the RunnableConfig LangGraph was invoked with,
    # which is how LangSmith run metadata reaches the nested policy graphs.
    def rank_jev(state: HybridState, config: RunnableConfig) -> dict[str, Any]:
        ranking = jev.rank(chess.Board(state.fen), run_config=config)
        return {"ranking": ranking, "gate_value": gate_value(ranking, hybrid.gate)}

    async def rank_jev_async(state: HybridState, config: RunnableConfig) -> dict[str, Any]:
        ranking = await jev.arank(chess.Board(state.fen), run_config=config)
        return {"ranking": ranking, "gate_value": gate_value(ranking, hybrid.gate)}

    def route(state: HybridState) -> str:
        return "play_jev" if state.gate_value >= hybrid.threshold else "shortlist"

    def _jev_fields(ranking: JevRanking) -> dict[str, Any]:
        return {
            "jev_confidence": ranking.confidence,
            "jev_margin": ranking.margin,
            "jev_top_k": ranking.top_k(hybrid.k),
            "jev_top_uci": ranking.top.uci,
        }

    def play_jev(state: HybridState) -> dict[str, Any]:
        ranking = state.ranking
        assert ranking is not None
        board = chess.Board(state.fen)
        decision = legal_decision(
            {m.uci() for m in board.legal_moves},
            uci=ranking.top.uci,
            source="jev",
            model=ranking.model,
            latency_ms=ranking.latency_ms,
            input_tokens=ranking.input_tokens,
            output_tokens=ranking.output_tokens,
            cost_usd=cost_usd(ranking.model, ranking.input_tokens, ranking.output_tokens),
            escalated=False,
            **_jev_fields(ranking),
        )
        return {"decision": decision}

    def make_shortlist(state: HybridState) -> dict[str, Any]:
        assert state.ranking is not None
        return {"candidates": [c.uci for c in shortlist(state.ranking, hybrid)]}

    def ask_llm(state: HybridState, config: RunnableConfig) -> dict[str, Any]:
        board = chess.Board(state.fen)
        return {"llm_decision": llm.decide(board, state.candidates, run_config=config)}

    async def ask_llm_async(state: HybridState, config: RunnableConfig) -> dict[str, Any]:
        board = chess.Board(state.fen)
        return {"llm_decision": await llm.adecide(board, state.candidates, run_config=config)}

    def decide(state: HybridState) -> dict[str, Any]:
        ranking, chosen = state.ranking, state.llm_decision
        assert ranking is not None
        assert chosen is not None
        board = chess.Board(state.fen)
        fell_back = chosen.source == "fallback_random"
        jev_cost = cost_usd(ranking.model, ranking.input_tokens, ranking.output_tokens) or 0.0
        total_cost = None if chosen.cost_usd is None else chosen.cost_usd + jev_cost
        decision = legal_decision(
            {m.uci() for m in board.legal_moves},
            uci=ranking.top.uci if fell_back else chosen.uci,
            source="fallback_jev" if fell_back else "llm",
            model=chosen.model,
            latency_ms=ranking.latency_ms + chosen.latency_ms,
            input_tokens=ranking.input_tokens + chosen.input_tokens,
            output_tokens=ranking.output_tokens + chosen.output_tokens,
            reasoning_tokens=chosen.reasoning_tokens,
            cost_usd=total_cost,
            escalated=True,
            illegal_attempts=chosen.illegal_attempts,
            raw_reply=chosen.raw_reply,
            **_jev_fields(ranking),
        )
        return {"decision": decision}

    graph: StateGraph[HybridState] = StateGraph(HybridState)
    graph.add_node("rank_jev", RunnableLambda(rank_jev, afunc=rank_jev_async))
    graph.add_node("play_jev", play_jev)
    graph.add_node("shortlist", make_shortlist)
    graph.add_node("ask_llm", RunnableLambda(ask_llm, afunc=ask_llm_async))
    graph.add_node("decide", decide)
    graph.add_edge(START, "rank_jev")
    graph.add_conditional_edges(
        "rank_jev", route, {"play_jev": "play_jev", "shortlist": "shortlist"}
    )
    graph.add_edge("play_jev", END)
    graph.add_edge("shortlist", "ask_llm")
    graph.add_edge("ask_llm", "decide")
    graph.add_edge("decide", END)
    return graph.compile()


class HybridPolicy:
    def __init__(self, jev: JevPolicy, llm: LLMPolicy, config: HybridConfig | None = None) -> None:
        self.config = config or HybridConfig()
        self._graph = build_graph(jev, llm, self.config)

    @classmethod
    def from_settings(
        cls, settings: Any = None, config: HybridConfig | None = None
    ) -> "HybridPolicy":
        config = config or HybridConfig()
        return cls(
            JevPolicy.from_settings(settings, config.jev),
            LLMPolicy.from_settings(settings, config.llm),
            config,
        )

    def decide(self, board: chess.Board, run_config: RunnableConfig | None = None) -> MoveDecision:
        result = self._graph.invoke(HybridState(fen=board.fen()), config=run_config)
        return cast("MoveDecision", result["decision"])

    async def adecide(
        self, board: chess.Board, run_config: RunnableConfig | None = None
    ) -> MoveDecision:
        result = await self._graph.ainvoke(HybridState(fen=board.fen()), config=run_config)
        return cast("MoveDecision", result["decision"])
