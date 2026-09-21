"""Jev as a move policy: one Choice over all legal moves, criteria are board-verified facts.

Built as a three-node LangGraph so the same shape (build request, call model, decide)
composes with the LLM policy and the hybrid later. Graph state is JSON-serialisable
(FEN plus SAN history) so games can be checkpointed and replayed.

Optionally the same request carries a Score (position evaluation) and two Nouls
(does this position need calculation; is a tactic available). Jev evaluates all questions
in parallel, so the extras cost a few dozen input tokens and no latency.
"""

import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol, cast

import chess
from langchain_core.runnables import RunnableLambda
from langchain_typesafe import Choice, Noul, Score, TypeSafeClassifier
from langchain_typesafe.types import (
    ChoiceAnswer,
    ClassifierRequest,
    ClassifierResponse,
    NoulAnswer,
    NoulCriteria,
    ScoreAnswer,
)
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from jev_chess.core import DescriptionStyle, all_move_facts, describe_all, material_balance
from jev_chess.core.position import side_of
from jev_chess.policies.types import Candidate, JevRanking
from jev_chess.settings import GatewaySettings

MOVE_QUESTION = "move"
EVAL_QUESTION = "eval"
CALCULATION_QUESTION = "needs_calculation"
TACTICS_QUESTION = "tactics_present"

# Deliberately no value ordering here (Dariel, 2026-09-21): sacrifices are sometimes right,
# and a stated preference would make Jev's ranking an echo of the prompt.
MOVE_INSTRUCTIONS = (
    "You are playing {side}. Choose the strongest legal move. Every option is a legal move in "
    "UCI notation with board-verified facts: what it captures, whether it gives check or "
    "checkmate, whether the destination square is attacked or defended, and the net material "
    "result of the exchange on that square."
)

EVAL_INSTRUCTIONS = (
    "Evaluate the position from White's point of view, considering material, king safety, "
    "piece activity, and pawn structure. Use the material count in the state as the starting "
    "point and adjust for the other factors."
)

EVAL_RUNGS: tuple[str, ...] = (
    "Black has a decisive advantage; White is lost with correct play",
    "Black is clearly better; roughly a piece or a major positional edge ahead",
    "Black is slightly better; roughly a pawn or a small positional edge ahead",
    "Equal; neither side has more than a token advantage",
    "White is slightly better; roughly a pawn or a small positional edge ahead",
    "White is clearly better; roughly a piece or a major positional edge ahead",
    "White has a decisive advantage; Black is lost with correct play",
)

CALCULATION_INSTRUCTIONS = (
    "Does choosing the best move here require calculating concrete variations several moves "
    "deep, rather than applying general principles such as development, centralisation, and "
    "piece safety?"
)
CALCULATION_CRITERIA = NoulCriteria(
    true=(
        "The position contains forcing sequences, hanging or attacked pieces on both sides, "
        "mating threats, or a pawn about to promote, so the right move depends on calculating "
        "what happens after it. A strong player would stop and work out lines before moving."
    ),
    false=(
        "No pieces are under immediate threat, there are no forcing captures or checks that "
        "change the material balance, and any reasonable developing or improving move keeps the "
        "position sound. A strong player would move quickly on principle."
    ),
)

TACTICS_INSTRUCTIONS = (
    "Is there a forcing tactical idea available to the side to move right now: a move that "
    "wins material, gives checkmate, or creates a threat the opponent must answer immediately?"
)
TACTICS_CRITERIA = NoulCriteria(
    true=(
        "At least one legal move captures material that cannot be safely recaptured, delivers "
        "or forces checkmate, or attacks a piece or the king in a way that forces a specific "
        "reply. The move facts list a positive exchange result, a check, or a checkmate for such "
        "a move."
    ),
    false=(
        "Every capture available is either equal or losing according to the exchange facts, no "
        "move gives check or mate, and the side to move has no immediate threat to make. The "
        "position is quiet."
    ),
)


class Classifier(Protocol):
    """The slice of TypeSafeClassifier the policy uses, so tests can inject a fake."""

    def invoke(self, input: ClassifierRequest, config: Any = None) -> ClassifierResponse: ...

    async def ainvoke(self, input: ClassifierRequest, config: Any = None) -> ClassifierResponse: ...


@dataclass(frozen=True, slots=True)
class JevConfig:
    model: str = "jev-latest"
    style: DescriptionStyle = "rich"
    history_plies: int = 6
    with_eval: bool = False
    with_nouls: bool = False


@dataclass
class JevState:
    """LangGraph state. Input is FEN plus SAN history; later nodes fill the rest."""

    fen: str
    history: list[str] = field(default_factory=list)
    request: ClassifierRequest | None = None
    response: ClassifierResponse | None = None
    latency_ms: float = 0.0
    ranking: JevRanking | None = None


def build_state(board: chess.Board, history: Sequence[str], config: JevConfig) -> dict[str, Any]:
    """The `state` blob Jev reads. Facts only; nothing here asks the model to see the board."""
    balance = material_balance(board)
    side = side_of(board.turn)
    recent = list(history[-config.history_plies :]) if config.history_plies else []
    return {
        "side_to_move": side,
        "fen": board.fen(),
        "board": str(board),
        "board_legend": "ranks 8 to 1 top to bottom, files a to h; uppercase is White",
        "material": {
            "white": balance.white,
            "black": balance.black,
            "for_side_to_move": balance.diff if side == "white" else -balance.diff,
        },
        "in_check": board.is_check(),
        "recent_moves_san": recent,
        "fullmove_number": board.fullmove_number,
    }


def build_questions(board: chess.Board, config: JevConfig) -> dict[str, Any]:
    facts = all_move_facts(board)
    questions: dict[str, Any] = {
        MOVE_QUESTION: Choice(
            instructions=MOVE_INSTRUCTIONS.format(side=side_of(board.turn)),
            criteria=dict(describe_all(facts, config.style)),
        )
    }
    if config.with_eval:
        questions[EVAL_QUESTION] = Score(instructions=EVAL_INSTRUCTIONS, criteria=list(EVAL_RUNGS))
    if config.with_nouls:
        questions[CALCULATION_QUESTION] = Noul(
            instructions=CALCULATION_INSTRUCTIONS, criteria=CALCULATION_CRITERIA
        )
        questions[TACTICS_QUESTION] = Noul(
            instructions=TACTICS_INSTRUCTIONS, criteria=TACTICS_CRITERIA
        )
    return questions


def build_request(
    board: chess.Board, history: Sequence[str], config: JevConfig
) -> ClassifierRequest:
    return {
        "state": build_state(board, history, config),
        "questions": build_questions(board, config),
    }


def _noul(response: ClassifierResponse, name: str) -> float | None:
    answer = response.answers.get(name)
    return answer.noul if isinstance(answer, NoulAnswer) else None


def parse_response(response: ClassifierResponse, latency_ms: float) -> JevRanking:
    answer = response.answers[MOVE_QUESTION]
    assert isinstance(answer, ChoiceAnswer), "move question must be a Choice"
    ordered = sorted(answer.probabilities.items(), key=lambda kv: (-kv[1], kv[0]))
    eval_answer = response.answers.get(EVAL_QUESTION)
    return JevRanking(
        candidates=tuple(Candidate(uci=u, probability=p) for u, p in ordered),
        confidence=answer.confidence,
        model=response.model,
        input_tokens=response.usage.input_tokens or 0,
        output_tokens=response.usage.output_tokens or 0,
        latency_ms=latency_ms,
        eval_score=eval_answer.score if isinstance(eval_answer, ScoreAnswer) else None,
        needs_calculation=_noul(response, CALCULATION_QUESTION),
        tactics_present=_noul(response, TACTICS_QUESTION),
    )


def build_graph(classifier: Classifier, config: JevConfig) -> CompiledStateGraph[JevState]:
    def prepare(state: JevState) -> dict[str, Any]:
        return {"request": build_request(chess.Board(state.fen), state.history, config)}

    def ask_jev(state: JevState) -> dict[str, Any]:
        assert state.request is not None
        started = time.perf_counter()
        response = classifier.invoke(state.request)
        return {"response": response, "latency_ms": (time.perf_counter() - started) * 1000}

    async def ask_jev_async(state: JevState) -> dict[str, Any]:
        assert state.request is not None
        started = time.perf_counter()
        response = await classifier.ainvoke(state.request)
        return {"response": response, "latency_ms": (time.perf_counter() - started) * 1000}

    def decide(state: JevState) -> dict[str, Any]:
        assert state.response is not None
        return {"ranking": parse_response(state.response, state.latency_ms)}

    graph: StateGraph[JevState] = StateGraph(JevState)
    graph.add_node("prepare", prepare)
    graph.add_node("ask_jev", RunnableLambda(ask_jev, afunc=ask_jev_async))
    graph.add_node("decide", decide)
    graph.add_edge(START, "prepare")
    graph.add_edge("prepare", "ask_jev")
    graph.add_edge("ask_jev", "decide")
    graph.add_edge("decide", END)
    return graph.compile()


def history_san(board: chess.Board) -> list[str]:
    """SAN of every move on the board's stack, oldest first."""
    replay = board.root()
    out: list[str] = []
    for move in board.move_stack:
        out.append(replay.san(move))
        replay.push(move)
    return out


class JevPolicy:
    """Rank legal moves with Jev. `rank` is sync, `arank` is async; both run the same graph."""

    def __init__(self, classifier: Classifier, config: JevConfig | None = None) -> None:
        self.config = config or JevConfig()
        self._graph = build_graph(classifier, self.config)

    @classmethod
    def from_settings(
        cls, settings: GatewaySettings | None = None, config: JevConfig | None = None
    ) -> "JevPolicy":
        settings = settings or GatewaySettings()
        config = config or JevConfig()
        classifier = TypeSafeClassifier(
            model=config.model,
            api_key=settings.typesafe_api_key,
            base_url=settings.typesafe_base_url,
        )
        return cls(classifier, config)

    def rank(self, board: chess.Board) -> JevRanking:
        result = self._graph.invoke(JevState(fen=board.fen(), history=history_san(board)))
        return cast("JevRanking", result["ranking"])

    async def arank(self, board: chess.Board) -> JevRanking:
        result = await self._graph.ainvoke(JevState(fen=board.fen(), history=history_san(board)))
        return cast("JevRanking", result["ranking"])
