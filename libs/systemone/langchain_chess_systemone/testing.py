"""Test fakes for SystemOne. Not used at runtime."""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import httpx2
from langchain_typesafe import Choice
from langchain_typesafe.client import TypeSafeAPIError
from langchain_typesafe.types import (
    ChoiceAnswer,
    ClassifierRequest,
    ClassifierResponse,
    NoulAnswer,
    ScoreAnswer,
    Usage,
)

from langchain_chess_systemone.types import (
    Candidate,
    MoveDistribution,
    RankingFailed,
    RankRequest,
)

SEMIF_OPTIONS = (2, 16)
SEMIF_QUESTIONS = 32


def api_error(status: int = 422, kind: type[TypeSafeAPIError] = TypeSafeAPIError) -> Exception:
    return kind(
        status, {"error": "invalid SemIf request"}, httpx2.Headers(), "invalid SemIf request"
    )


def distribution(
    probabilities: Mapping[str, float], confidence: float = 0.5, model: str = "fake"
) -> MoveDistribution:
    """A sorted distribution from `{uci: probability}`, ties in the given order."""
    order = sorted(probabilities, key=lambda u: -probabilities[u])
    return MoveDistribution(
        candidates=tuple(Candidate(u, probabilities[u]) for u in order),
        confidence=confidence,
        model=model,
        latency_ms=1.0,
        calls=(),
    )


type Script = Callable[[RankRequest], MoveDistribution | BaseException]


@dataclass
class FakeRanker:
    """Returns scripted distributions (or raises scripted errors), recording every request."""

    script: Sequence[MoveDistribution | BaseException] | Script
    max_options: int = 16
    requests: list[RankRequest] = field(default_factory=list)

    def rank(self, request: RankRequest) -> MoveDistribution:
        self.requests.append(request)
        step = (
            self.script[len(self.requests) - 1]
            if isinstance(self.script, Sequence)
            else self.script(request)
        )
        if isinstance(step, BaseException):
            raise step
        return step

    async def arank(self, request: RankRequest) -> MoveDistribution:
        return self.rank(request)


def failed(message: str = "ranker down", calls: Sequence[Any] = ()) -> RankingFailed:
    return RankingFailed(message, calls)


def choice_answer(probabilities: dict[str, float], confidence: float = 0.5) -> ChoiceAnswer:
    top = max(probabilities, key=lambda k: probabilities[k])
    return ChoiceAnswer(
        type="choice", choice=top, probabilities=probabilities, confidence=confidence
    )


type Answerer = Callable[[str, list[str]], dict[str, float] | ChoiceAnswer]


def by_option_order(name: str, options: list[str]) -> dict[str, float]:
    """Earlier options score higher: weights n, n-1, ... 1, normalized."""
    weights = list(range(len(options), 0, -1))
    total = sum(weights)
    return {uci: w / total for uci, w in zip(options, weights, strict=True)}


@dataclass
class FakeTypeSafeClient:
    """Stands in for `TypeSafeClassifier`. Enforces SemIf's real limits when `semif` is set:
    2 to 16 options per Choice and at most 32 questions per request."""

    answer: Answerer = by_option_order
    semif: bool = True
    confidence: float = 0.4
    input_tokens: int | None = None
    output_tokens: int | None = None
    model: str = "semif-qwen3.5-4b"
    errors: list[BaseException] = field(default_factory=list)
    requests: list[ClassifierRequest] = field(default_factory=list)

    def _respond(self, request: ClassifierRequest) -> ClassifierResponse:
        self.requests.append(request)
        if self.errors:
            raise self.errors.pop(0)
        questions = request["questions"]
        if self.semif and len(questions) > SEMIF_QUESTIONS:
            raise api_error()
        answers: dict[str, Any] = {}
        for name, question in questions.items():
            if isinstance(question, Choice):
                options = list(question.criteria)
                low, high = SEMIF_OPTIONS
                if self.semif and not low <= len(options) <= high:
                    raise api_error()
                result = self.answer(name, options)
                answers[name] = (
                    result
                    if isinstance(result, ChoiceAnswer)
                    else choice_answer(result, self.confidence)
                )
            elif question.type == "score":
                answers[name] = ScoreAnswer(
                    type="score",
                    score=4.2,
                    legend={i: f"rung {i}" for i in range(7)},
                    probabilities={i: 1 / 7 for i in range(7)},
                    confidence=0.3,
                )
            else:
                answers[name] = NoulAnswer(type="noul", noul=0.25)
        return ClassifierResponse(
            model=self.model,
            answers=answers,
            usage=Usage(input_tokens=self.input_tokens, output_tokens=self.output_tokens),
        )

    def invoke(self, input: ClassifierRequest, config: Any = None) -> ClassifierResponse:
        return self._respond(input)

    async def ainvoke(self, input: ClassifierRequest, config: Any = None) -> ClassifierResponse:
        return self._respond(input)
