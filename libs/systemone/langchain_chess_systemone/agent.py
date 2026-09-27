"""`build_agent`: the chess agent a `ChessContext` describes, for every surface.

Surfaces inject what they own: the model and ranker factories, the checkpointer, and their own
middleware.
"""

from collections.abc import Callable, Sequence
from typing import Any

from langchain.agents.middleware.types import AgentMiddleware
from langchain_core.language_models.chat_models import BaseChatModel
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Checkpointer

from langchain_chess import ChessContractError, create_chess_agent
from langchain_chess.chat_models import chat_model
from langchain_chess.middleware.summarization import input_limit
from langchain_chess.model_arguments import ModelArguments, Surface, model_arguments
from langchain_chess_systemone.middleware import NoSystemOne, SystemOneMiddleware
from langchain_chess_systemone.ranker import GatewayRanker
from langchain_chess_systemone.settings import ChessContext
from langchain_chess_systemone.types import Ranker

type ModelFactory = Callable[[ChessContext], BaseChatModel]
type RankerFactory = Callable[[ChessContext], Ranker]


def arguments(settings: ChessContext, surface: Surface = "local") -> ModelArguments:
    """What the model is built with and sends: `model_kwargs` over the settings."""
    return model_arguments(
        settings.model_kwargs, reasoning_effort=settings.reasoning_effort, surface=surface
    )


def sent(settings: ChessContext, surface: Surface = "local") -> dict[str, Any]:
    """The settings as sent, for labels and run metadata; the recorded settings keep
    `model_kwargs` as given. Without the LLM nothing is sent, and its settings go unread."""
    if settings.policy == "systemone":
        return {"reasoning_effort": None}
    resolved = arguments(settings, surface)
    values: dict[str, Any] = {"reasoning_effort": resolved.reasoning_effort}
    if resolved.max_tokens is not None:
        values["max_tokens"] = resolved.max_tokens
    return values


def default_model(settings: ChessContext) -> BaseChatModel:
    return chat_model(settings.model, arguments(settings))


def default_ranker(settings: ChessContext) -> Ranker:
    return GatewayRanker(
        settings.systemone_model,
        style=settings.style,
        with_eval=settings.with_eval,
        with_nouls=settings.with_nouls,
    )


def systemone(settings: ChessContext, ranker: Ranker) -> SystemOneMiddleware:
    alone = settings.policy == "systemone"
    return SystemOneMiddleware(
        settings.systemone_model,
        gate=settings.gate,
        # System 1 alone must always play: there is no model behind it.
        threshold=0.0 if alone else settings.threshold,
        tournament_threshold=0.0 if alone else settings.tournament_threshold,
        k=settings.k,
        top_p=settings.top_p,
        has_model=not alone,
        ranker=ranker,
    )


def build_agent(
    settings: ChessContext,
    *,
    model_factory: ModelFactory = default_model,
    ranker_factory: RankerFactory = default_ranker,
    checkpointer: Checkpointer | None = None,
    middleware: Sequence[AgentMiddleware[Any, Any, Any]] = (),
    fixed_topology: bool = False,
    context_schema: type | None = None,
    name: str = "chess",
) -> CompiledStateGraph:
    """Only the factories a policy uses are called. `middleware` runs after System 1.

    `fixed_topology=True` keeps System 1's and summarization's nodes when they're off, so every
    setting builds one graph, as an Agent Server graph factory needs.
    """
    model = None if settings.policy == "systemone" else model_factory(settings)
    stack: list[AgentMiddleware[Any, Any, Any]] = []
    if settings.policy != "llm":
        stack.append(systemone(settings, ranker_factory(settings)))
    elif fixed_topology:
        stack.append(NoSystemOne())
    stack.extend(middleware)
    memory = settings.memory and model is not None
    if memory and model is not None and input_limit(model) is None:
        msg = f"{settings.model} has no known input limit, so it can't use memory; turn it off"
        raise ChessContractError(msg)
    return create_chess_agent(
        model,
        middleware=stack,
        system_prompt=settings.system_prompt,
        show_fen=settings.show_fen,
        show_board=settings.show_board,
        move_list=settings.move_list,
        memory=memory,
        draw_claims=settings.draw_claims,
        seed=settings.seed,
        fixed_topology=fixed_topology,
        context_schema=context_schema,
        checkpointer=checkpointer,
        name=name,
    )
