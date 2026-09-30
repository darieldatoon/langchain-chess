"""Agent state and the records it keeps.

Everything here must serialize through LangGraph's codecs: strings, numbers, lists, TypedDicts
and LangChain messages. The omission markers are metadata inside `Annotated`, not generics.
There are no custom reducers; the write guard enforces who may write what.
"""

from typing import Annotated, Literal, NotRequired, TypedDict, get_type_hints

from langchain.agents.middleware.types import (
    AgentState,
    OmitFromInput,
    OmitFromOutput,
    PrivateStateAttr,
)
from langchain_core.messages import AnyMessage

type JSONValue = str | int | float | bool | list[JSONValue] | dict[str, JSONValue] | None
type Side = Literal["white", "black"]
type DrawReason = Literal[
    "stalemate",
    "insufficient_material",
    "threefold",
    "fivefold",
    "fifty_moves",
    "seventyfive_moves",
]
type TurnStatus = Literal["pending", "committed", "abandoned", "terminal"]
type DrawAnswer = Literal["declined"]
type CallKind = Literal["llm", "systemone", "summary"]


class PositionInput(TypedDict, total=False):
    start_fen: str
    """Default: the standard start."""
    moves: list[str]
    """UCI moves from `start_fen`."""
    restrict: list[str]
    """A hard restriction on the moves to consider (UCI `searchmoves`). Non-empty."""


class ChessInput(TypedDict, total=False):
    """What callers send. `create_agent` derives the real input schema from `ChessState`."""

    messages: list[AnyMessage]
    position: PositionInput


class Call(TypedDict):
    kind: CallKind
    model: str
    """Canonical `provider:model`."""
    input_tokens: int | None
    """None when the provider reports none (SemIf)."""
    output_tokens: int | None
    reasoning_tokens: int
    cache_read_tokens: int | None
    cache_write_tokens: int | None
    """All cache writes, every TTL."""
    cache_write_1h_tokens: int | None
    """The 1-hour subset of `cache_write_tokens`."""
    called_at: str
    """ISO 8601."""
    cost_usd: float | None
    """None if the model is unknown or usage was unreported."""
    cost_complete: bool
    """False if a usage dimension was approximated."""
    priced_with: str | None
    """The genai-prices version."""


class TurnRecord(TypedDict):
    id: str
    request: str
    """Fingerprint of the command that opened the turn."""
    initial_allowed: list[str]
    """Legal moves ∩ `restrict` when the turn opened, in legal order."""
    status: TurnStatus
    ply: int | None
    """Index into `plies` once committed."""
    calls: list[Call]
    rejected_message_ids: list[str]
    feedback_message_ids: list[str]
    opened_message_id: str | None
    illegal_attempts: int
    latency_ms: float
    """Summed model-call time; extensions' `turn_latency_ms` is added when the turn finalizes."""


class Invocation(TypedDict):
    """This run only; separate from the durable turn status."""

    id: str
    action: Literal["execute", "reject", "noop"]
    opened_turn: NotRequired[str | None]
    """The turn this run opened, if any; a retry opens none. Absent on older checkpoints."""


class FailedCall(TypedDict):
    """A model call that failed after some provider calls completed; ChessCore re-raises it."""

    id: str
    error: str


class Proposal(TypedDict):
    uci: str
    source: str
    """`llm`, `systemone`, `forced`, or an extension's name."""
    analysis: NotRequired[str | None]
    meta: NotRequired[dict[str, JSONValue]]


class Ply(TypedDict):
    ply: int
    side: Side
    uci: str
    san: str
    source: str
    """`external` for moves from input, else `Proposal.source`."""
    analysis: str | None
    message_id: str | None
    """The committed AI message (it may since have been summarized away)."""
    turn_id: str | None
    """None for external moves."""
    model: str | None
    latency_ms: float
    meta: dict[str, dict[str, JSONValue]]
    """Keyed by middleware name."""


class Checkmate(TypedDict):
    kind: Literal["checkmate"]
    winner: Side


class Draw(TypedDict):
    kind: Literal["draw"]
    reason: DrawReason


class Resignation(TypedDict):
    kind: Literal["resignation"]
    winner: Side
    reason: Literal["illegal_moves", "resigned"]
    """`illegal_moves` is a forfeit: the agent ran out of attempts at a legal move."""


class DrawOffer(TypedDict):
    ply: int
    """`len(moves)` when it was offered: the completed half-moves, possibly 0."""
    by: Side
    answer: DrawAnswer


type Outcome = Checkmate | Draw | Resignation


class ChessState(AgentState):
    # The game record: core-owned, in the output, never accepted as input.
    start_fen: NotRequired[Annotated[str, OmitFromInput]]
    moves: NotRequired[Annotated[list[str], OmitFromInput]]
    plies: NotRequired[Annotated[list[Ply], OmitFromInput]]
    outcome: NotRequired[Annotated[Outcome | None, OmitFromInput]]
    """Authoritative once set."""
    turns: NotRequired[Annotated[list[TurnRecord], OmitFromInput]]
    """Every turn, even ones that produced no move."""
    error: NotRequired[Annotated[str | None, OmitFromInput]]
    """The last rejection reason."""
    draw_offers: NotRequired[Annotated[list[DrawOffer], OmitFromInput]]
    """Absent on games recorded before draw offers: read it as `[]`."""
    # Input only; ChessCore clears it every run.
    position: NotRequired[Annotated[PositionInput | None, OmitFromOutput]]
    # Turn working state: private.
    allowed_moves: NotRequired[Annotated[list[str], PrivateStateAttr]]
    candidates: NotRequired[Annotated[list[str] | None, PrivateStateAttr]]
    candidates_by: NotRequired[Annotated[str | None, PrivateStateAttr]]
    """The middleware that wrote `candidates` this turn; set by the write guard."""
    proposal: NotRequired[Annotated[Proposal | None, PrivateStateAttr]]
    fallback_move: NotRequired[Annotated[str | None, PrivateStateAttr]]
    consumed_message_ids: NotRequired[Annotated[list[str], PrivateStateAttr]]
    terminal_intent: NotRequired[Annotated[Resignation | None, PrivateStateAttr]]
    failed_call: NotRequired[Annotated[FailedCall | None, PrivateStateAttr]]
    invocation: NotRequired[Annotated[Invocation, PrivateStateAttr]]


CHESS_KEYS: frozenset[str] = frozenset(get_type_hints(ChessState, include_extras=True))
"""Every `ChessState` key, `messages` included."""

RECORD_KEYS: frozenset[str] = frozenset(
    {"start_fen", "moves", "plies", "outcome", "turns", "error", "draw_offers"}
)
"""What clients may read: the thread-state API also returns the private channels."""
