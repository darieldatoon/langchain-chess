"""The `chess` graph factory. Construction is cheap and never calls a model.

The server calls the factory to run a thread and, without the run's settings, to read or update
its state and to describe the graph. Every call must build the same nodes, edges and state
schema, so a setting may switch a node off but never remove it.
"""

from functools import lru_cache

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.runnables import RunnableConfig
from langchain_typesafe import TypeSafeClassifier
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Checkpointer
from langgraph_sdk.runtime import ServerRuntime

from langchain_chess import ChessContractError, create_chess_agent
from langchain_chess.chat_models import chat_model as base_chat_model
from langchain_chess.middleware.summarization import input_limit
from langchain_chess_server.clients import POOL
from langchain_chess_server.context import ChessContext, resolve_context
from langchain_chess_server.game_setup import GameSetupMiddleware
from langchain_chess_server.settings import ServerSettings
from langchain_chess_systemone import GatewayRanker, NoSystemOne, SystemOneMiddleware


def chat_model(context: ChessContext) -> BaseChatModel:
    return base_chat_model(context.model, context.reasoning_effort)


@lru_cache(maxsize=64)
def model_limit(model: str) -> int | None:
    """What the new-game dialog asks before offering `summarize`; None if it can't be built."""
    try:
        return input_limit(chat_model(ChessContext(model=model)))
    except (ValueError, ImportError):
        return None


def _classifier(model: str, api_key: str, base_url: str) -> TypeSafeClassifier:
    client, async_client = POOL.get()
    return TypeSafeClassifier(
        model=model,
        api_key=api_key,
        base_url=base_url,
        client=client,
        async_client=async_client,
    )


def systemone(context: ChessContext, settings: ServerSettings) -> SystemOneMiddleware:
    alone = context.policy == "systemone"
    client = _classifier(context.systemone_model, *settings.typesafe())
    ranker = GatewayRanker(
        context.systemone_model,
        style=context.style,
        with_eval=context.with_eval,
        with_nouls=context.with_nouls,
        client=client,
    )
    return SystemOneMiddleware(
        context.systemone_model,
        gate=context.gate,
        # System 1 alone must always play: there is no model behind it.
        threshold=0.0 if alone else context.threshold,
        tournament_threshold=0.0 if alone else context.tournament_threshold,
        k=context.k,
        top_p=context.top_p,
        has_model=not alone,
        ranker=ranker,
    )


def build_agent(
    context: ChessContext,
    settings: ServerSettings,
    *,
    checkpointer: Checkpointer | None = None,
) -> CompiledStateGraph:
    model = None if context.policy == "systemone" else chat_model(context)
    middleware = [
        NoSystemOne() if context.policy == "llm" else systemone(context, settings),
        GameSetupMiddleware(context),
    ]
    memory = "none" if model is None else context.memory
    if model is not None and memory == "summarize" and input_limit(model) is None:
        msg = (
            f"{context.model} has no known input limit, so it can't use memory='summarize'; "
            "use memory='none'"
        )
        raise ChessContractError(msg)
    return create_chess_agent(
        model,
        middleware=middleware,
        show_legal_moves=context.show_legal_moves,
        memory=memory,
        draw_claims=context.draw_claims,
        seed=context.seed,
        fixed_topology=True,
        context_schema=ChessContext,
        checkpointer=checkpointer,
        name="chess",
    )


def shape() -> CompiledStateGraph:
    """The graph with every node switched off: no model, no clients, no credentials."""
    return create_chess_agent(
        None,
        # Its context is never written: this graph never runs.
        middleware=[NoSystemOne(), GameSetupMiddleware(ChessContext())],
        fixed_topology=True,
        context_schema=ChessContext,
        name="chess",
    )


def make_graph(config: RunnableConfig, runtime: ServerRuntime[ChessContext]) -> CompiledStateGraph:
    """Assistant settings arrive through `runtime`; dropping it would silently lose them.

    Only a run carries them; reads, updates and introspection get the same graph's shape.
    """
    if runtime.execution_runtime is None:
        return shape()
    return build_agent(resolve_context(ChessContext, config, runtime), ServerSettings())
