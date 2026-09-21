"""A scripted classifier standing in for TypeSafeClassifier."""

from dataclasses import dataclass, field
from typing import Any

from langchain_typesafe import Choice
from langchain_typesafe.types import (
    ChoiceAnswer,
    ClassifierRequest,
    ClassifierResponse,
    ScoreAnswer,
    Usage,
)


def choice_response(
    probabilities: dict[str, float],
    confidence: float = 0.5,
    model: str = "jev-test",
    eval_score: float | None = None,
    input_tokens: int | None = 100,
) -> ClassifierResponse:
    top = max(probabilities, key=lambda k: probabilities[k])
    answers: dict[str, Any] = {
        "move": ChoiceAnswer(
            type="choice", choice=top, probabilities=probabilities, confidence=confidence
        )
    }
    if eval_score is not None:
        answers["eval"] = ScoreAnswer(
            type="score",
            score=eval_score,
            legend={i: f"rung {i}" for i in range(7)},
            probabilities={i: (1.0 if i == round(eval_score) else 0.0) for i in range(7)},
            confidence=0.9,
        )
    return ClassifierResponse(
        model=model, answers=answers, usage=Usage(input_tokens=input_tokens, output_tokens=10)
    )


@dataclass
class FakeClassifier:
    """Returns uniform probabilities over the request's options unless scripted."""

    scripted: ClassifierResponse | None = None
    requests: list[ClassifierRequest] = field(default_factory=list)

    def _respond(self, request: ClassifierRequest) -> ClassifierResponse:
        self.requests.append(request)
        if self.scripted is not None:
            return self.scripted
        question = request["questions"]["move"]
        assert isinstance(question, Choice)
        options = list(question.criteria)
        weight = 1.0 / len(options)
        return choice_response(dict.fromkeys(options, weight), confidence=0.1)

    def invoke(self, input: ClassifierRequest, config: Any = None) -> ClassifierResponse:
        return self._respond(input)

    async def ainvoke(self, input: ClassifierRequest, config: Any = None) -> ClassifierResponse:
        return self._respond(input)
