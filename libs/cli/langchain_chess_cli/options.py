"""The agent a CLI adapter plays with, built from its options."""

from collections.abc import Callable
from dataclasses import asdict, dataclass
from typing import Literal

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.runnables import RunnableConfig
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Checkpointer

from langchain_chess import ChessContractError, create_chess_agent
from langchain_chess.chat_models import chat_model
from langchain_chess.middleware.summarization import input_limit
from langchain_chess.rules import DrawClaims
from langchain_chess_systemone import SystemOneMiddleware

type Policy = Literal["llm", "systemone", "hybrid"]
type ReasoningEffort = Literal["low", "medium", "high"]
type Memory = Literal["none", "summarize"]
type Surface = Literal["tui", "uci"]


@dataclass(frozen=True, slots=True)
class AgentOptions:
    """Mirrors the server's context knobs, with the same defaults."""

    policy: Policy = "hybrid"
    model: str = "langsmith:baseten/zai-org/GLM-5.3-Flash"
    reasoning_effort: ReasoningEffort | None = None
    show_legal_moves: bool = True
    memory: Memory = "none"
    systemone_model: str = "semif-qwen3.5-4b"
    style: Literal["rich", "terse"] = "rich"
    with_eval: bool = False
    with_nouls: bool = False
    gate: Literal["margin", "confidence"] = "margin"
    threshold: float = 0.9
    tournament_threshold: float | None = None
    k: int = 5
    top_p: float | None = None
    seed: int = 0


type ModelFactory = Callable[[AgentOptions], BaseChatModel]


def default_model(options: AgentOptions) -> BaseChatModel:
    return chat_model(options.model, options.reasoning_effort)


def build_agent(
    options: AgentOptions,
    *,
    draw_claims: DrawClaims,
    checkpointer: Checkpointer,
    model_factory: ModelFactory = default_model,
) -> CompiledStateGraph:
    alone = options.policy == "systemone"
    middleware = []
    if options.policy != "llm":
        middleware.append(
            SystemOneMiddleware(
                options.systemone_model,
                style=options.style,
                gate=options.gate,
                # System 1 alone must always play: there is no model behind it.
                threshold=0.0 if alone else options.threshold,
                tournament_threshold=0.0 if alone else options.tournament_threshold,
                k=options.k,
                top_p=options.top_p,
                with_eval=options.with_eval,
                with_nouls=options.with_nouls,
                has_model=not alone,
            )
        )
    model = None if alone else model_factory(options)
    memory = "none" if model is None else options.memory
    if model is not None and memory == "summarize" and input_limit(model) is None:
        msg = (
            f"{options.model} has no known input limit, so it can't use memory summarize; "
            "use memory none"
        )
        raise ChessContractError(msg)
    return create_chess_agent(
        model,
        middleware=middleware,
        show_legal_moves=options.show_legal_moves,
        memory=memory,
        draw_claims=draw_claims,
        seed=options.seed,
        checkpointer=checkpointer,
        name="chess",
    )


def run_config(
    surface: Surface, thread_id: str, options: AgentOptions, *, draw_claims: DrawClaims
) -> RunnableConfig:
    """Names and tags the trace by surface; the knobs go in metadata, as on server traces."""
    return {
        "configurable": {"thread_id": thread_id},
        "run_name": f"chess-{surface}",
        "tags": [surface],
        "metadata": {"surface": surface, **asdict(options), "draw_claims": draw_claims},
    }
