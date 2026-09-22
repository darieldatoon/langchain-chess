"""A reasoning LLM as a move policy, with legality checking and bounded retries.

Graph: prepare -> call_llm -> parse -> (decide | feedback -> call_llm | fallback -> decide).
The model sees the PGN so far, the FEN, an ASCII board, and optionally the legal moves.
Legal-move lists are a flag because the literature says they hurt chat models, yet the
hybrid must pass a shortlist; both baselines need measuring. An illegal reply gets a reason
and the legal list, up to `max_retries` times, then a random legal move is played and the
fallback is recorded rather than hidden.
"""

import random
import re
import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol, cast

import chess
from langchain.chat_models import init_chat_model
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig, RunnableLambda
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from jev_chess.core import snapshot
from jev_chess.core.position import side_of
from jev_chess.policies.pricing import cost_usd
from jev_chess.policies.types import MoveDecision, ReasoningEffort, legal_decision
from jev_chess.settings import GatewaySettings

DEFAULT_MODEL = "langsmith:anthropic/claude-opus-5"
GATEWAY_PREFIX = "langsmith:"

# Bare model names route through the gateway; the provider is inferred from the name so
# `claude-opus-5` becomes `langsmith:anthropic/claude-opus-5`.
_NAME_PREFIXES: tuple[tuple[str, str], ...] = (
    ("claude", "anthropic"),
    ("gpt", "openai"),
    ("o1", "openai"),
    ("o3", "openai"),
    ("o4", "openai"),
)


def resolve_model_spec(text: str) -> str:
    """Expand a bare model name to a gateway spec; pass explicit `provider:model` through."""
    if ":" in text:
        return text
    for prefix, provider in _NAME_PREFIXES:
        if text.startswith(prefix):
            return f"{GATEWAY_PREFIX}{provider}/{text}"
    msg = f"cannot infer a provider for {text!r}; use provider:model or langsmith:provider/model"
    raise ValueError(msg)


def bare_model_name(spec: str) -> str:
    """Strip provider prefixes: both gateway and direct specs give the plain model name."""
    return spec.rsplit("/", 1)[-1].rsplit(":", 1)[-1]


SYSTEM_PROMPT = (
    "You are a strong chess player. You will be shown a game in progress and asked for your "
    "next move. Think as deeply as you need, then end your reply with exactly one line of the "
    "form `MOVE: <move>` where <move> is in standard algebraic notation (for example "
    "`MOVE: Nf3`, `MOVE: exd5`, `MOVE: O-O`, `MOVE: e8=Q`). Play only legal moves."
)


EMPTY_REPLY = "[no text in reply]"


class ChatModel(Protocol):
    """The slice of a LangChain chat model the policy uses, so tests can inject a fake."""

    def invoke(self, input: Sequence[BaseMessage], config: Any = None) -> AIMessage: ...

    async def ainvoke(self, input: Sequence[BaseMessage], config: Any = None) -> AIMessage: ...


@dataclass(frozen=True, slots=True)
class LLMConfig:
    """`model` is an `init_chat_model` spec: `langsmith:openai/gpt-5.6-sol` (gateway, default
    style) or `openai:gpt-5.6-sol` (direct to the provider, needs that provider's key)."""

    model: str = DEFAULT_MODEL
    reasoning_effort: ReasoningEffort = "medium"
    include_legal_moves: bool = True
    max_retries: int = 3
    # Output cap covers reasoning too. 8000 was exhausted by Opus at medium effort mid-game
    # (2026-09-22), which returned empty text; keep this well above any reasoning budget.
    max_tokens: int = 32000
    seed: int = 0

    @property
    def model_name(self) -> str:
        return bare_model_name(self.model)

    @property
    def via_gateway(self) -> bool:
        return self.model.startswith(GATEWAY_PREFIX)

    @property
    def label(self) -> str:
        return f"{self.model}:{self.reasoning_effort}"


@dataclass
class LLMState:
    fen: str
    history: list[str] = field(default_factory=list)
    candidates: list[str] | None = None
    messages: list[BaseMessage] = field(default_factory=list)
    attempts: int = 0
    reply: str = ""
    parsed_uci: str | None = None
    rejection: str | None = None
    latency_ms: float = 0.0
    input_tokens: int = 0
    output_tokens: int = 0
    reasoning_tokens: int = 0
    decision: MoveDecision | None = None


def san_list(board: chess.Board, ucis: Sequence[str]) -> list[str]:
    return [board.san(chess.Move.from_uci(u)) for u in ucis]


def build_prompt(
    board: chess.Board,
    history: Sequence[str],
    config: LLMConfig,
    candidates: Sequence[str] | None,
) -> str:
    position = snapshot(board)
    lines = [
        f"Moves so far: {position.pgn or '(none, this is the first move)'}",
        f"FEN: {position.fen}",
        "Board (ranks 8 to 1, uppercase is White):",
        f"```\n{board}\n```",
        f"{side_of(board.turn).capitalize()} to move.",
    ]
    if board.is_check():
        lines.append("You are in check.")
    if candidates is not None:
        lines.append(
            "Choose one of these candidate moves: " + ", ".join(san_list(board, candidates))
        )
    elif config.include_legal_moves:
        lines.append("Legal moves: " + ", ".join(san_list(board, position.legal_moves)))
    lines.append("Reply with your analysis, then the final line `MOVE: <move>`.")
    return "\n".join(lines)


_MOVE_LINE = re.compile(r"MOVE:\s*\**\s*([^\s*`]+)", re.IGNORECASE)
_MOVE_TOKEN = re.compile(
    r"\b(O-O(?:-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=?[QRBN])?|[a-h][1-8][a-h][1-8][qrbn]?)[+#]?\b"
)


def _normalise(token: str) -> str:
    token = token.strip().strip(".,;:!?)\"'").replace("0-0-0", "O-O-O").replace("0-0", "O-O")
    return token.replace("o-o-o", "O-O-O").replace("o-o", "O-O")


def parse_move(board: chess.Board, reply: str) -> tuple[chess.Move | None, str | None]:
    """Return the legal move named in the reply, or a reason it was rejected."""
    marked = _MOVE_LINE.findall(reply)
    tokens = [_normalise(m) for m in reversed(marked)] or [
        _normalise(m) for m in reversed(_MOVE_TOKEN.findall(reply))
    ]
    if not tokens:
        return None, "no move found; end your reply with a line `MOVE: <move>`"
    for token in tokens:
        for parser in (board.parse_san, board.parse_uci):
            try:
                return parser(token), None  # both parsers raise on illegal moves
            except ValueError:
                continue
    return None, f"`{tokens[0]}` is not a legal move in this position"


def _text(message: AIMessage) -> str:
    content = message.content
    if isinstance(content, str):
        return content
    parts: list[str] = []
    for block in content:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict) and block.get("type") == "text":
            parts.append(str(block.get("text", "")))
    return "\n".join(parts)


def _usage(message: AIMessage) -> tuple[int, int, int]:
    usage = message.usage_metadata or {}
    details = usage.get("output_token_details") or {}
    return (
        int(usage.get("input_tokens", 0)),
        int(usage.get("output_tokens", 0)),
        int(details.get("reasoning", 0) or 0),
    )


def make_chat_model(config: LLMConfig, settings: GatewaySettings | None = None) -> ChatModel:
    """`init_chat_model(config.model, ...)`. Gateway specs get the gateway key and URL passed
    explicitly; direct specs rely on the provider integration's own environment."""
    kwargs: dict[str, Any] = {
        "reasoning_effort": config.reasoning_effort,
        "max_tokens": config.max_tokens,
    }
    if config.via_gateway:
        settings = settings or GatewaySettings()
        kwargs["base_url"] = f"{settings.gateway_url}/v1"
        kwargs["api_key"] = settings.langsmith_gateway_api_key
    return cast("ChatModel", init_chat_model(config.model, **kwargs))


def build_graph(
    model: ChatModel, config: LLMConfig, context_schema: Any = None
) -> CompiledStateGraph[LLMState]:
    rng = random.Random(config.seed)

    def prepare(state: LLMState) -> dict[str, Any]:
        board = chess.Board(state.fen)
        prompt = build_prompt(board, state.history, config, state.candidates)
        return {"messages": [SystemMessage(SYSTEM_PROMPT), HumanMessage(prompt)]}

    def _absorb(state: LLMState, reply: AIMessage, started: float) -> dict[str, Any]:
        i, o, r = _usage(reply)
        text = _text(reply)
        # Anthropic rejects a replayed assistant turn with empty text, so keep a placeholder in
        # the transcript when the model produced none (typically the output cap hit reasoning).
        kept = (
            reply
            if text.strip()
            else AIMessage(content=EMPTY_REPLY, usage_metadata=reply.usage_metadata)
        )
        return {
            "messages": [*state.messages, kept],
            "reply": text,
            "attempts": state.attempts + 1,
            "latency_ms": state.latency_ms + (time.perf_counter() - started) * 1000,
            "input_tokens": state.input_tokens + i,
            "output_tokens": state.output_tokens + o,
            "reasoning_tokens": state.reasoning_tokens + r,
        }

    def call_llm(state: LLMState) -> dict[str, Any]:
        started = time.perf_counter()
        return _absorb(state, model.invoke(state.messages), started)

    async def call_llm_async(state: LLMState) -> dict[str, Any]:
        started = time.perf_counter()
        return _absorb(state, await model.ainvoke(state.messages), started)

    def parse(state: LLMState) -> dict[str, Any]:
        board = chess.Board(state.fen)
        move, rejection = parse_move(board, state.reply)
        if move is not None and state.candidates is not None and move.uci() not in state.candidates:
            move, rejection = None, f"`{board.san(move)}` is not one of the candidate moves"
        return {"parsed_uci": move.uci() if move else None, "rejection": rejection}

    def route(state: LLMState) -> str:
        if state.parsed_uci is not None:
            return "decide"
        return "feedback" if state.attempts <= config.max_retries else "fallback"

    def feedback(state: LLMState) -> dict[str, Any]:
        board = chess.Board(state.fen)
        allowed = (
            state.candidates if state.candidates is not None else list(snapshot(board).legal_moves)
        )
        reason = (
            "your reply had no text, so the output budget was probably spent on reasoning"
            if not state.reply.strip()
            else f"that move was rejected: {state.rejection}"
        )
        text = (
            f"Try again, {reason}. Choose from: {', '.join(san_list(board, allowed))}. "
            "Keep the reply short and end with `MOVE: <move>`."
        )
        return {"messages": [*state.messages, HumanMessage(text)]}

    def fallback(state: LLMState) -> dict[str, Any]:
        board = chess.Board(state.fen)
        pool = state.candidates if state.candidates else list(snapshot(board).legal_moves)
        return {"parsed_uci": rng.choice(pool), "rejection": state.rejection}

    def decide(state: LLMState) -> dict[str, Any]:
        board = chess.Board(state.fen)
        assert state.parsed_uci is not None
        fell_back = state.rejection is not None and state.attempts > config.max_retries
        decision = legal_decision(
            {m.uci() for m in board.legal_moves},
            uci=state.parsed_uci,
            source="fallback_random" if fell_back else "llm",
            model=config.model_name,
            latency_ms=state.latency_ms,
            input_tokens=state.input_tokens,
            output_tokens=state.output_tokens,
            reasoning_tokens=state.reasoning_tokens,
            cost_usd=cost_usd(config.model_name, state.input_tokens, state.output_tokens),
            illegal_attempts=state.attempts - (0 if fell_back else 1),
            raw_reply=state.reply,
        )
        return {"decision": decision}

    graph: StateGraph[LLMState, Any] = StateGraph(LLMState, context_schema=context_schema)
    graph.add_node("prepare", prepare)
    graph.add_node("call_llm", RunnableLambda(call_llm, afunc=call_llm_async))
    graph.add_node("parse", parse)
    graph.add_node("feedback", feedback)
    graph.add_node("fallback", fallback)
    graph.add_node("decide", decide)
    graph.add_edge(START, "prepare")
    graph.add_edge("prepare", "call_llm")
    graph.add_edge("call_llm", "parse")
    graph.add_conditional_edges(
        "parse", route, {"decide": "decide", "feedback": "feedback", "fallback": "fallback"}
    )
    graph.add_edge("feedback", "call_llm")
    graph.add_edge("fallback", "decide")
    graph.add_edge("decide", END)
    return graph.compile()


def history_san(board: chess.Board) -> list[str]:
    replay = board.root()
    out: list[str] = []
    for move in board.move_stack:
        out.append(replay.san(move))
        replay.push(move)
    return out


class LLMPolicy:
    """Ask a reasoning LLM for a move. `candidates` restricts it to a shortlist (hybrid)."""

    def __init__(
        self,
        model: ChatModel,
        config: LLMConfig | None = None,
        context_schema: Any = None,
    ) -> None:
        self.config = config or LLMConfig()
        self._graph = build_graph(model, self.config, context_schema)

    @classmethod
    def from_settings(
        cls,
        settings: GatewaySettings | None = None,
        config: LLMConfig | None = None,
        context_schema: Any = None,
    ) -> "LLMPolicy":
        config = config or LLMConfig()
        return cls(make_chat_model(config, settings), config, context_schema)

    @property
    def graph(self) -> CompiledStateGraph[LLMState]:
        return self._graph

    def _input(self, board: chess.Board, candidates: Sequence[str] | None) -> LLMState:
        return LLMState(
            fen=board.fen(),
            history=history_san(board),
            candidates=list(candidates) if candidates is not None else None,
        )

    def decide(
        self,
        board: chess.Board,
        candidates: Sequence[str] | None = None,
        run_config: RunnableConfig | None = None,
    ) -> MoveDecision:
        result = self._graph.invoke(self._input(board, candidates), config=run_config)
        return cast("MoveDecision", result["decision"])

    async def adecide(
        self,
        board: chess.Board,
        candidates: Sequence[str] | None = None,
        run_config: RunnableConfig | None = None,
    ) -> MoveDecision:
        result = await self._graph.ainvoke(self._input(board, candidates), config=run_config)
        return cast("MoveDecision", result["decision"])
