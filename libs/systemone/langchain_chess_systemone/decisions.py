"""`DecisionsClassifier`: OpenAI Decisions behind the ranker's TypeSafe-shaped `Classifier`.

The ranker builds one request shape (a `state`, plus Choice, Score and Noul questions) and reads
one answer shape. This translates both ways, so retries, validation, tournaments and tracing
stay in `GatewayRanker` for every System 1 model. Calls go through LangChain's
`OpenAIDecisions`, never the HTTP endpoint directly.
"""

from typing import Any

from langchain_openai import decisions as od
from langchain_typesafe import Choice, Noul, Score
from langchain_typesafe.types import (
    ChoiceAnswer,
    ClassifierRequest,
    ClassifierResponse,
    NoulAnswer,
    ScoreAnswer,
    Usage,
)

PREFIX = "openai/"
"""`openai/<model>` names a Decisions model, as `typesafe/<model>` names a TypeSafe one."""


def _text(value: Any) -> str:
    return value if isinstance(value, str) else str(value)


def _predicate(question: Noul) -> od.Predicate:
    """Decisions predicates take no criteria, so the yes and no meanings join the instructions."""
    parts = [_text(question.instructions)]
    if question.criteria is not None:
        if question.criteria.true is not None:
            parts.append(f"Yes means: {_text(question.criteria.true)}")
        if question.criteria.false is not None:
            parts.append(f"No means: {_text(question.criteria.false)}")
    return od.Predicate(instructions=" ".join(parts))


def to_decisions(request: ClassifierRequest) -> od.DecisionRequest:
    questions: dict[str, Any] = {}
    for name, question in request["questions"].items():
        if isinstance(question, Choice):
            questions[name] = od.Choice(
                instructions=_text(question.instructions),
                choices={k: None if v is None else _text(v) for k, v in question.criteria.items()},
            )
        elif isinstance(question, Score):
            questions[name] = od.Score(
                instructions=_text(question.instructions),
                levels=[od.Level(label=_text(level)) for level in question.criteria],
            )
        else:
            questions[name] = _predicate(question)
    return {"input": request["state"], "questions": questions}


def from_decisions(response: od.DecisionResponse) -> ClassifierResponse:
    """A refusal has no TypeSafe counterpart, so it's left out: the ranker reads a missing
    answer as malformed, the same as any unusable one."""
    answers: dict[str, Any] = {}
    for name, answer in response.answers.items():
        match answer:
            case od.ChoiceAnswer():
                answers[name] = ChoiceAnswer(
                    type="choice",
                    choice=str(answer.choice),
                    probabilities={str(k): v for k, v in answer.probabilities.items()},
                    confidence=answer.confidence,
                )
            case od.ScoreAnswer():
                answers[name] = ScoreAnswer(
                    type="score",
                    score=answer.score,
                    legend=dict(answer.legend),
                    probabilities=dict(answer.probabilities),
                    confidence=answer.confidence,
                )
            case od.PredicateAnswer():
                answers[name] = NoulAnswer(type="noul", noul=answer.probability)
    usage = Usage(
        input_tokens=response.usage.input_tokens, output_tokens=response.usage.output_tokens
    )
    return ClassifierResponse(model=response.model, answers=answers, usage=usage)


class DecisionsClassifier:
    """The `Classifier` the ranker calls, backed by `OpenAIDecisions`."""

    def __init__(self, decisions: od.OpenAIDecisions) -> None:
        self.decisions = decisions

    def invoke(self, input: ClassifierRequest, config: Any = None) -> ClassifierResponse:
        return from_decisions(self.decisions.invoke(to_decisions(input), config))

    async def ainvoke(self, input: ClassifierRequest, config: Any = None) -> ClassifierResponse:
        return from_decisions(await self.decisions.ainvoke(to_decisions(input), config))
