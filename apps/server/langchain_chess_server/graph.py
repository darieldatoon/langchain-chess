"""The `chess` graph factory. Construction is cheap and never calls a model."""

from functools import lru_cache
from typing import Any

from langchain.chat_models import init_chat_model
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.runnables import RunnableConfig
from langchain_typesafe import TypeSafeClassifier
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Checkpointer
from langgraph_sdk.runtime import ServerRuntime

from langchain_chess import ChessContractError, create_chess_agent
from langchain_chess.middleware.summarization import input_limit
from langchain_chess.models import GATEWAY_PREFIX, model_identity
from langchain_chess.pricing import context_window
from langchain_chess_server.context import ChessContext, resolve_context
from langchain_chess_server.settings import ServerSettings
from langchain_chess_systemone import GatewayRanker, SystemOneMiddleware

MAX_TOKENS = 32000
"""The output cap covers reasoning too; 8000 ran out mid-game at medium effort."""


def chat_model(context: ChessContext) -> BaseChatModel:
    model = context.model
    name = model_identity(model)[1]
    kwargs: dict[str, Any] = {
        "reasoning_effort": context.reasoning_effort,
        "max_tokens": MAX_TOKENS,
        # The trace span's name; through the gateway every vendor would read as `ChatOpenAI`.
        "name": name,
    }
    # The gateway's ChatOpenAI has no profile, and summarize's fractional trigger needs one.
    # Native providers ship full profiles; never replace them.
    if model.startswith(GATEWAY_PREFIX) and (window := context_window(model)):
        kwargs["profile"] = {"max_input_tokens": window - MAX_TOKENS}
    return init_chat_model(model, **kwargs)


@lru_cache(maxsize=64)
def model_limit(model: str) -> int | None:
    """What the new-game dialog asks before offering `summarize`; None if it can't be built."""
    try:
        return input_limit(chat_model(ChessContext(model=model)))
    except (ValueError, ImportError):
        return None


@lru_cache(maxsize=8)
def _classifier(model: str, api_key: str, base_url: str) -> TypeSafeClassifier:
    return TypeSafeClassifier(model=model, api_key=api_key, base_url=base_url, timeout=15.0)


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
    middleware = [] if context.policy == "llm" else [systemone(context, settings)]
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
        context_schema=ChessContext,
        checkpointer=checkpointer,
        name="chess",
    )


def make_graph(config: RunnableConfig, runtime: ServerRuntime[ChessContext]) -> CompiledStateGraph:
    """Assistant settings arrive through `runtime`; dropping it would silently lose them."""
    return build_agent(resolve_context(ChessContext, config, runtime), ServerSettings())
