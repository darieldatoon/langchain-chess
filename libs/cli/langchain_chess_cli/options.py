"""The agent a CLI adapter plays with, built from its options."""

from collections.abc import Callable
from dataclasses import asdict, dataclass
from typing import Literal

from langchain.agents.middleware import SummarizationMiddleware
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.runnables import RunnableConfig
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Checkpointer

from langchain_chess import create_chess_agent
from langchain_chess.middleware.summarization import CHESS_SUMMARY_PROMPT, DEFAULT_KEEP
from langchain_chess.rules import DrawClaims
from langchain_chess_cli.models import chat_model
from langchain_chess_systemone import SystemOneMiddleware

type Policy = Literal["llm", "systemone", "hybrid"]
type ReasoningEffort = Literal["low", "medium", "high"]
type Memory = Literal["none", "full", "summarize"]
type Surface = Literal["tui", "uci"]


@dataclass(frozen=True, slots=True)
class AgentOptions:
    """Mirrors the server's context knobs, with the same defaults."""

    policy: Policy = "hybrid"
    model: str = "claude-opus-5-5"
    reasoning_effort: ReasoningEffort = "medium"
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
    summary_trigger_tokens: int | None = None


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
    summarization = None
    if model is not None and options.summary_trigger_tokens is not None:
        summarization = SummarizationMiddleware(
            model,
            trigger=("tokens", options.summary_trigger_tokens),
            keep=DEFAULT_KEEP,
            summary_prompt=CHESS_SUMMARY_PROMPT,
        )
    return create_chess_agent(
        model,
        middleware=middleware,
        show_legal_moves=options.show_legal_moves,
        memory="none" if model is None else options.memory,
        summarization=summarization,
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
