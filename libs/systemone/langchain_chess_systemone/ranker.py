"""`GatewayRanker`: SemIf or Jev over the LLM Gateway's `/v1/systemone` route.

One Choice asks for the strongest move; its option criteria are board-verified move facts.
Optionally the final request also carries a Score (position evaluation) and two Nouls (does the
position need calculation; is a tactic available), which cost a few dozen input tokens and no
latency. More options than one Choice may hold go through a tournament (`tournament.py`).
"""

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

import chess
from langchain_typesafe import Choice, Noul, Score, TypeSafeClassifier
from langchain_typesafe.client import (
    TypeSafeAPIConnectionError,
    TypeSafeAPITimeoutError,
    TypeSafeInternalServerError,
    TypeSafeRateLimitError,
)
from langchain_typesafe.types import (
    ChoiceAnswer,
    ClassifierRequest,
    ClassifierResponse,
    NoulAnswer,
    NoulCriteria,
    ScoreAnswer,
)

from langchain_chess.pricing import Tokens, make_call
from langchain_chess.state import Call
from langchain_chess_systemone.describe import DescriptionStyle, describe_moves, material_balance
from langchain_chess_systemone.tournament import FINAL, Batch, ChoiceSpec, adrive, drive, plan
from langchain_chess_systemone.types import (
    Answers,
    Aux,
    Candidate,
    ChoiceResult,
    MoveDistribution,
    RankingFailed,
    RankRequest,
    Tournament,
)
from langchain_chess_systemone.validate import MalformedChoice, validate_choice

TRANSIENT_ERRORS = (
    TypeSafeRateLimitError,
    TypeSafeAPIConnectionError,
    TypeSafeAPITimeoutError,
    TypeSafeInternalServerError,
)
BASE_BACKOFF_S = 0.5
MAX_BACKOFF_S = 4.0

# The gateway advertises no limits; these are its validation caps. Unknown models get 16,
# which costs only an extra round if their real cap is larger.
MAX_OPTIONS_BY_PREFIX: tuple[tuple[str, int], ...] = (("semif-", 16), ("typesafe/jev-", 255))
DEFAULT_MAX_OPTIONS = 16
CHOICE_LIMIT = 255

EVAL_QUESTION = "eval"
CALCULATION_QUESTION = "needs_calculation"
TACTICS_QUESTION = "tactics_present"

# Trace span names: one request ranks every option, or a tournament sends heats then a final.
RANK_RUN = "systemone.rank"
HEATS_RUN = "systemone.heats"
FINAL_RUN = "systemone.final"

# Deliberately no value ordering here (Dariel, 2026-09-21): sacrifices are sometimes right,
# and a stated preference would make the ranking an echo of the prompt.
MOVE_INSTRUCTIONS = (
    "You are playing {side}. Choose the strongest legal move. Every option is a legal move in "
    "UCI notation with board-verified facts: what it captures, whether it gives check or "
    "checkmate, whether the destination square is attacked or defended, and the net material "
    "result of the exchange on that square."
)
SUBSET_INSTRUCTIONS = " Only some of the legal moves are listed; choose the strongest of those."

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
    """The slice of `TypeSafeClassifier` the ranker uses, so tests can inject a fake."""

    def invoke(self, input: ClassifierRequest, config: Any = None) -> ClassifierResponse: ...

    async def ainvoke(self, input: ClassifierRequest, config: Any = None) -> ClassifierResponse: ...


def default_max_options(model: str) -> int:
    for prefix, cap in MAX_OPTIONS_BY_PREFIX:
        if model.startswith(prefix):
            return cap
    return DEFAULT_MAX_OPTIONS


def backoff_seconds(attempt: int) -> float:
    return min(MAX_BACKOFF_S, BASE_BACKOFF_S * 2**attempt)


def _side(board: chess.Board) -> str:
    return "white" if board.turn == chess.WHITE else "black"


@dataclass(frozen=True, slots=True)
class _Position:
    board: chess.Board
    recent_san: tuple[str, ...]


def _position(request: RankRequest, history_plies: int) -> _Position:
    board = chess.Board(request.start_fen)
    sans: list[str] = []
    for uci in request.moves:
        move = chess.Move.from_uci(uci)
        sans.append(board.san(move))
        board.push(move)
    recent = tuple(sans[-history_plies:]) if history_plies else ()
    return _Position(board=board, recent_san=recent)


def build_state(position: _Position) -> dict[str, Any]:
    """The `state` blob the ranker reads. Facts only."""
    board = position.board
    balance = material_balance(board)
    side = _side(board)
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
        "recent_moves_san": list(position.recent_san),
        "fullmove_number": board.fullmove_number,
    }


def build_questions(
    board: chess.Board,
    batch: Batch,
    style: DescriptionStyle,
    *,
    with_eval: bool,
    with_nouls: bool,
) -> dict[str, Any]:
    instructions = MOVE_INSTRUCTIONS.format(side=_side(board))
    questions: dict[str, Any] = {
        spec.name: Choice(
            instructions=instructions + (SUBSET_INSTRUCTIONS if spec.heat else ""),
            criteria=dict(describe_moves(board, spec.options, style)),
        )
        for spec in batch.choices
    }
    if batch.with_aux and with_eval:
        questions[EVAL_QUESTION] = Score(instructions=EVAL_INSTRUCTIONS, criteria=list(EVAL_RUNGS))
    if batch.with_aux and with_nouls:
        questions[CALCULATION_QUESTION] = Noul(
            instructions=CALCULATION_INSTRUCTIONS, criteria=CALCULATION_CRITERIA
        )
        questions[TACTICS_QUESTION] = Noul(
            instructions=TACTICS_INSTRUCTIONS, criteria=TACTICS_CRITERIA
        )
    return questions


def _noul(response: ClassifierResponse, name: str) -> float | None:
    answer = response.answers.get(name)
    return answer.noul if isinstance(answer, NoulAnswer) else None


def tournament_run_name(batch: Batch) -> str:
    # Not `spec.heat`: the final lists only the finalists, so it is flagged as a heat too.
    return FINAL_RUN if any(spec.name == FINAL for spec in batch.choices) else HEATS_RUN


def parse_answers(batch: Batch, response: ClassifierResponse) -> Answers:
    """Validate every Choice against its own options. Raises `MalformedChoice`."""
    choices: dict[str, ChoiceResult] = {}
    for spec in batch.choices:
        answer = response.answers.get(spec.name)
        if not isinstance(answer, ChoiceAnswer):
            msg = f"no Choice answer for `{spec.name}`"
            raise MalformedChoice(msg)
        choices[spec.name] = validate_choice(spec.options, answer.probabilities, answer.confidence)
    score = response.answers.get(EVAL_QUESTION)
    aux = Aux(
        eval_score=score.score if isinstance(score, ScoreAnswer) else None,
        needs_calculation=_noul(response, CALCULATION_QUESTION),
        tactics_present=_noul(response, TACTICS_QUESTION),
    )
    return Answers(choices=choices, aux=aux)


class GatewayRanker:
    """Ranks moves with a System 1 model. `rank` is sync, `arank` async; both retry transient
    gateway errors with backoff and record one `Call` per request."""

    def __init__(
        self,
        model: str,
        *,
        style: DescriptionStyle = "rich",
        with_eval: bool = False,
        with_nouls: bool = False,
        max_options: int | None = None,
        client: Classifier | None = None,
        history_plies: int = 6,
        # System 1 answers in well under a second; a call that runs long is a stalled
        # connection, so give up early and retry rather than wait out the 30 s default.
        timeout_s: float = 15.0,
        max_attempts: int = 3,
        sleep: Callable[[float], None] = time.sleep,
        asleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        cap = default_max_options(model) if max_options is None else max_options
        if not 2 <= cap <= CHOICE_LIMIT:
            msg = f"max_options must be within 2..{CHOICE_LIMIT}, got {cap}"
            raise ValueError(msg)
        self.model = model
        self.style: DescriptionStyle = style
        self.with_eval = with_eval
        self.with_nouls = with_nouls
        self.max_options = cap
        self.history_plies = history_plies
        self.max_attempts = max_attempts
        self._sleep = sleep
        self._asleep = asleep
        self._timeout_s = timeout_s
        self._client = client

    @property
    def client(self) -> Classifier:
        """Built on first use, so constructing a graph needs no credentials."""
        if self._client is None:
            self._client = TypeSafeClassifier(model=self.model, timeout=self._timeout_s)
        return self._client

    # ---- one request --------------------------------------------------------------------------

    def _request(self, position: _Position, batch: Batch) -> ClassifierRequest:
        return {
            "state": build_state(position),
            "questions": build_questions(
                position.board,
                batch,
                self.style,
                with_eval=self.with_eval,
                with_nouls=self.with_nouls,
            ),
        }

    def _call(self, response: ClassifierResponse, at: datetime) -> Call:
        tokens = Tokens(input=response.usage.input_tokens, output=response.usage.output_tokens)
        return make_call("systemone", self.model, tokens, at, provider="typesafe")

    def _answers(
        self, batch: Batch, response: ClassifierResponse, at: datetime, calls: list[Call]
    ) -> Answers:
        calls.append(self._call(response, at))
        try:
            return parse_answers(batch, response)
        except MalformedChoice as e:
            msg = f"malformed {self.model} response: {e}"
            raise RankingFailed(msg, calls) from e

    def _ask(self, position: _Position, batch: Batch, calls: list[Call], run_name: str) -> Answers:
        request = self._request(position, batch)
        attempt = 0
        while True:
            at = datetime.now(UTC)
            try:
                response = self.client.invoke(request, {"run_name": run_name})
            except TRANSIENT_ERRORS as e:
                attempt += 1
                if attempt >= self.max_attempts:
                    msg = f"{self.model} failed after {attempt} attempts: {e}"
                    raise RankingFailed(msg, calls) from e
                self._sleep(backoff_seconds(attempt - 1))
                continue
            except Exception as e:
                raise RankingFailed(f"{self.model} failed: {e}", calls) from e
            return self._answers(batch, response, at, calls)

    async def _aask(
        self, position: _Position, batch: Batch, calls: list[Call], run_name: str
    ) -> Answers:
        request = self._request(position, batch)
        attempt = 0
        while True:
            at = datetime.now(UTC)
            try:
                response = await self.client.ainvoke(request, {"run_name": run_name})
            except TRANSIENT_ERRORS as e:
                attempt += 1
                if attempt >= self.max_attempts:
                    msg = f"{self.model} failed after {attempt} attempts: {e}"
                    raise RankingFailed(msg, calls) from e
                await self._asleep(backoff_seconds(attempt - 1))
                continue
            except Exception as e:
                raise RankingFailed(f"{self.model} failed: {e}", calls) from e
            return self._answers(batch, response, at, calls)

    # ---- a ranking ----------------------------------------------------------------------------

    def _single(self, request: RankRequest) -> Batch:
        return Batch((ChoiceSpec(FINAL, request.options, heat=False),), with_aux=True)

    def _distribution(
        self,
        final: ChoiceResult,
        aux: Aux,
        tournament: Tournament | None,
        calls: list[Call],
        started: float,
    ) -> MoveDistribution:
        return MoveDistribution(
            candidates=final.ranked,
            confidence=final.confidence,
            model=self.model,
            latency_ms=(time.perf_counter() - started) * 1000,
            calls=tuple(calls),
            tournament=tournament,
            eval_score=aux.eval_score,
            needs_calculation=aux.needs_calculation,
            tactics_present=aux.tactics_present,
        )

    def _local(self, request: RankRequest) -> MoveDistribution:
        """One option needs no request: probability and confidence 1, no call."""
        return MoveDistribution(
            candidates=(Candidate(uci=request.options[0], probability=1.0),),
            confidence=1.0,
            model=self.model,
            latency_ms=0.0,
            calls=(),
        )

    def rank(self, request: RankRequest) -> MoveDistribution:
        if len(request.options) == 1:
            return self._local(request)
        started = time.perf_counter()
        position = _position(request, self.history_plies)
        calls: list[Call] = []
        if len(request.options) <= self.max_options:
            answers = self._ask(position, self._single(request), calls, RANK_RUN)
            return self._distribution(answers.choices[FINAL], answers.aux, None, calls, started)
        steps = plan(request.options, self.max_options, request.seed)
        result = drive(
            steps, lambda batch: self._ask(position, batch, calls, tournament_run_name(batch))
        )
        return self._distribution(result.final, result.aux, result.tournament, calls, started)

    async def arank(self, request: RankRequest) -> MoveDistribution:
        if len(request.options) == 1:
            return self._local(request)
        started = time.perf_counter()
        position = _position(request, self.history_plies)
        calls: list[Call] = []
        if len(request.options) <= self.max_options:
            answers = await self._aask(position, self._single(request), calls, RANK_RUN)
            return self._distribution(answers.choices[FINAL], answers.aux, None, calls, started)
        steps = plan(request.options, self.max_options, request.seed)
        result = await adrive(
            steps, lambda batch: self._aask(position, batch, calls, tournament_run_name(batch))
        )
        return self._distribution(result.final, result.aux, result.tournament, calls, started)
