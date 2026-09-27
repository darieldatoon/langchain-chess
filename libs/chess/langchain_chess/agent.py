"""`create_chess_agent`: a chess agent on `create_agent(tools=[])`."""

from collections.abc import Mapping, Sequence
from typing import Any

from langchain.agents import create_agent
from langchain.agents.middleware import SummarizationMiddleware
from langchain.agents.middleware.types import AgentMiddleware
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langchain_core.outputs import ChatResult
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Checkpointer

from langchain_chess.contract import guard
from langchain_chess.errors import ChessContractError
from langchain_chess.middleware.core import ChessCore
from langchain_chess.middleware.forced_move import ForcedMoveMiddleware
from langchain_chess.middleware.stall_retry import StallRetry
from langchain_chess.middleware.summarization import (
    ChessSummarization,
    NoSummarization,
    Overhead,
)
from langchain_chess.prompt import SYSTEM_PROMPT, PositionRenderer, position_renderer
from langchain_chess.recorder import CallRecorder
from langchain_chess.rules import DrawClaims
from langchain_chess.settings import ListedMoves
from langchain_chess.state import ChessState

INPUT_KEYS = frozenset({"messages", "position"})


class NoModel(BaseChatModel):
    """Stands in when middleware always proposes. Calling it is a bug, so it fails loudly
    rather than letting a System-1-only agent play a random move."""

    @property
    def _llm_type(self) -> str:
        return "no-model"

    def _generate(
        self, messages: Any, stop: Any = None, run_manager: Any = None, **kwargs: Any
    ) -> ChatResult:
        msg = "no model is configured, and no middleware proposed a move"
        raise ChessContractError(msg)


def _summarizer(
    model: str | BaseChatModel | None,
    summarization: SummarizationMiddleware | None,
    *,
    recorder: CallRecorder,
    max_retries: int,
    overhead: Overhead,
) -> ChessSummarization:
    if model is None:
        msg = "memory needs a model"
        raise ChessContractError(msg)
    if summarization is not None:
        return ChessSummarization.from_middleware(
            summarization, recorder=recorder, max_retries=max_retries, overhead=overhead
        )
    return ChessSummarization(model, recorder=recorder, max_retries=max_retries, overhead=overhead)


def create_chess_agent(
    model: str | BaseChatModel | None = None,
    *,
    middleware: Sequence[AgentMiddleware[Any, Any, Any]] = (),
    system_prompt: str | None = None,
    show_fen: bool = True,
    show_board: bool = True,
    move_list: ListedMoves = "both",
    render_position: PositionRenderer | None = None,
    memory: bool = False,
    summarization: SummarizationMiddleware | None = None,
    max_retries: int = 3,
    draw_claims: DrawClaims = "auto",
    forced_move: bool = True,
    seed: int = 0,
    fixed_topology: bool = False,
    context_schema: type | None = None,
    checkpointer: Checkpointer | None = None,
    name: str | None = None,
) -> CompiledStateGraph:
    """Build a chess agent. One run plays at most one turn; one thread is one game.

    `model=None` only works if middleware always proposes (a System-1-only agent). Without a
    checkpointer the agent is stateless and every run must carry a `position`.
    `show_fen`, `show_board` and `move_list` shape the bundled position section of each
    turn's message; `render_position` replaces it (they are then unused). With `memory=True`,
    summarizing counts the system prompt and the turn's message too.
    `fixed_topology=True` keeps the summarization node with `memory=False`, so the graph's
    nodes don't depend on `memory`: the Agent Server reads state with a graph built without
    the run's settings.
    """
    if system_prompt == "":
        msg = "system_prompt must not be empty; pass None for the bundled prompt"
        raise ChessContractError(msg)
    prompt = system_prompt or SYSTEM_PROMPT
    render = render_position or position_renderer(
        show_fen=show_fen, show_board=show_board, move_list=move_list
    )
    guarded = [guard(m, seed=seed) for m in middleware]
    declared: dict[str, str] = {}
    for proxy in guarded:
        for key in getattr(proxy, "own_keys", frozenset()):
            if key in declared:
                msg = f"`{key}` is declared by both {declared[key]} and {proxy.name}"
                raise ChessContractError(msg)
            declared[key] = proxy.name

    recorder = CallRecorder()
    core = ChessCore(
        memory=memory,
        max_retries=max_retries,
        draw_claims=draw_claims,
        render=render,
        recorder=recorder,
        extensions=guarded,
    )
    stack: list[AgentMiddleware[Any, Any, Any]] = [core]
    if forced_move:
        stack.append(ForcedMoveMiddleware())
    stack.extend(guarded)
    if memory:

        def overhead(state: Mapping[str, Any]) -> list[BaseMessage]:
            return [SystemMessage(prompt), HumanMessage(core.turn_message(state))]

        summarizer = _summarizer(
            model, summarization, recorder=recorder, max_retries=max_retries, overhead=overhead
        )
        summarizer.check_room(prompt)
        # Last, so it runs only right before an actual LLM call.
        stack.append(summarizer)
    elif fixed_topology:
        stack.append(NoSummarization())
    stack.append(StallRetry())

    graph = create_agent(
        model or NoModel(),
        tools=[],
        system_prompt=prompt,
        state_schema=ChessState,
        middleware=stack,
        context_schema=context_schema,
        checkpointer=checkpointer,
        name=name,
    )
    accepted = set(graph.get_input_jsonschema().get("properties", {}))
    if extra := accepted - INPUT_KEYS:
        msg = (
            f"the input schema exposes {sorted(extra)}; mark middleware state keys "
            "PrivateStateAttr or OmitFromInput, and don't redeclare ChessState keys"
        )
        raise ChessContractError(msg)
    return graph.with_config(callbacks=[recorder])
