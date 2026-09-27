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

from langchain_chess import create_chess_agent
from langchain_chess.chat_models import chat_model
from langchain_chess.middleware.summarization import input_limit
from langchain_chess_server.clients import POOL
from langchain_chess_server.context import resolve_context
from langchain_chess_server.game_setup import GameSetupMiddleware
from langchain_chess_server.settings import ServerSettings
from langchain_chess_systemone import GatewayRanker, NoSystemOne, Ranker
from langchain_chess_systemone.agent import (
    ModelFactory,
    RankerFactory,
    arguments,
    build_agent,
    default_model,
    sent,
)
from langchain_chess_systemone.settings import ChessContext, ChessContextInput


@lru_cache(maxsize=64)
def model_limit(model: str) -> int | None:
    """What the new-game dialog asks before offering memory; None if it can't be built."""
    try:
        return input_limit(default_model(ChessContext(model=model)))
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


def server_model(settings: ChessContext) -> BaseChatModel:
    """The model with only the `model_kwargs` the server allows."""
    return chat_model(settings.model, arguments(settings, "server"))


def pooled_ranker(server: ServerSettings) -> RankerFactory:
    """System 1 on the process's shared connections, with the server's credentials."""

    def ranker(settings: ChessContext) -> Ranker:
        client = _classifier(settings.systemone_model, *server.typesafe())
        return GatewayRanker(
            settings.systemone_model,
            style=settings.style,
            with_eval=settings.with_eval,
            with_nouls=settings.with_nouls,
            client=client,
        )

    return ranker


def build_graph(
    settings: ChessContext,
    *,
    ranker_factory: RankerFactory,
    model_factory: ModelFactory = server_model,
    checkpointer: Checkpointer | None = None,
) -> CompiledStateGraph:
    """Run metadata records the values sent, where `model_kwargs` changed them."""
    graph = build_agent(
        settings,
        model_factory=model_factory,
        ranker_factory=ranker_factory,
        checkpointer=checkpointer,
        middleware=[GameSetupMiddleware(settings)],
        fixed_topology=True,
        context_schema=ChessContextInput,
    )
    return graph.with_config(metadata=sent(settings, "server"))


def shape() -> CompiledStateGraph:
    """The graph with every node switched off: no model, no clients, no credentials."""
    return create_chess_agent(
        None,
        # Its settings are never written: this graph never runs.
        middleware=[NoSystemOne(), GameSetupMiddleware(ChessContext())],
        fixed_topology=True,
        context_schema=ChessContextInput,
        name="chess",
    )


def make_graph(config: RunnableConfig, runtime: ServerRuntime) -> CompiledStateGraph:
    """Assistant settings arrive through `runtime`; dropping it would silently lose them.

    Only a run carries them; reads, updates and introspection get the same graph's shape.
    """
    if runtime.execution_runtime is None:
        return shape()
    settings = resolve_context(config, runtime)
    return build_graph(settings, ranker_factory=pooled_ranker(ServerSettings()))
