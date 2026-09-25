"""The `chess` graph factory. Construction is cheap and never calls a model."""

from functools import lru_cache
from typing import Any

from langchain.agents.middleware import SummarizationMiddleware
from langchain.chat_models import init_chat_model
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.runnables import RunnableConfig
from langchain_typesafe import TypeSafeClassifier
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Checkpointer
from langgraph_sdk.runtime import ServerRuntime

from langchain_chess import create_chess_agent, resolve_model_spec
from langchain_chess.middleware.summarization import CHESS_SUMMARY_PROMPT, DEFAULT_KEEP
from langchain_chess.models import GATEWAY_PREFIX
from langchain_chess_server.context import ChessContext, resolve_context
from langchain_chess_server.settings import GatewaySettings
from langchain_chess_systemone import GatewayRanker, SystemOneMiddleware

MAX_TOKENS = 32000
"""The output cap covers reasoning too; 8000 ran out mid-game at medium effort."""

# The gateway's ChatOpenAI has no profile, and a fractional summarization trigger needs one.
PROFILES: dict[str, dict[str, Any]] = {
    "claude-opus-5": {"max_input_tokens": 1_000_000},
    "claude-opus-5-5": {"max_input_tokens": 1_000_000},
}


def chat_model(context: ChessContext, settings: GatewaySettings) -> BaseChatModel:
    spec = resolve_model_spec(context.model)
    kwargs: dict[str, Any] = {
        "reasoning_effort": context.reasoning_effort,
        "max_tokens": MAX_TOKENS,
        # The trace span's name; through the gateway every vendor would read as `ChatOpenAI`.
        "name": context.model,
    }
    if spec.startswith(GATEWAY_PREFIX):
        kwargs["base_url"] = f"{settings.gateway_url}/v1"
        kwargs["api_key"] = settings.langsmith_gateway_api_key.get_secret_value()
    if (profile := PROFILES.get(spec.rsplit("/", 1)[-1].rsplit(":", 1)[-1])) is not None:
        kwargs["profile"] = profile
    return init_chat_model(spec, **kwargs)


@lru_cache(maxsize=8)
def _classifier(model: str, api_key: str, base_url: str) -> TypeSafeClassifier:
    return TypeSafeClassifier(model=model, api_key=api_key, base_url=base_url, timeout=15.0)


def summarization(
    model: BaseChatModel | None, trigger_tokens: int | None
) -> SummarizationMiddleware | None:
    """An absolute trigger for models without a profile; None keeps the fractional default."""
    if model is None or trigger_tokens is None:
        return None
    return SummarizationMiddleware(
        model,
        trigger=("tokens", trigger_tokens),
        keep=DEFAULT_KEEP,
        summary_prompt=CHESS_SUMMARY_PROMPT,
    )


def systemone(context: ChessContext, settings: GatewaySettings) -> SystemOneMiddleware:
    alone = context.policy == "systemone"
    client = _classifier(
        context.systemone_model,
        settings.typesafe_api_key.get_secret_value(),
        settings.typesafe_base_url,
    )
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
    settings: GatewaySettings,
    *,
    checkpointer: Checkpointer | None = None,
) -> CompiledStateGraph:
    model = None if context.policy == "systemone" else chat_model(context, settings)
    middleware = [] if context.policy == "llm" else [systemone(context, settings)]
    memory = "none" if model is None else context.memory
    return create_chess_agent(
        model,
        middleware=middleware,
        show_legal_moves=context.show_legal_moves,
        memory=memory,
        summarization=summarization(model, context.summary_trigger_tokens),
        draw_claims=context.draw_claims,
        seed=context.seed,
        context_schema=ChessContext,
        checkpointer=checkpointer,
        name="chess",
    )


def make_graph(config: RunnableConfig, runtime: ServerRuntime[ChessContext]) -> CompiledStateGraph:
    """Assistant settings arrive through `runtime`; dropping it would silently lose them."""
    return build_agent(resolve_context(ChessContext, config, runtime), GatewaySettings())
