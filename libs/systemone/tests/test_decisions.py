import chess
import pytest
from langchain_openai import decisions as od
from langchain_typesafe import Choice, Noul, Score, TypeSafeClassifier
from langchain_typesafe.types import ChoiceAnswer, NoulAnswer, NoulCriteria, ScoreAnswer

from langchain_chess_systemone import GatewayRanker, RankRequest
from langchain_chess_systemone.decisions import DecisionsClassifier, from_decisions, to_decisions
from langchain_chess_systemone.ranker import classifier, default_max_options
from langchain_chess_systemone.types import RankingFailed

LEGAL = tuple(m.uci() for m in chess.Board().legal_moves)


def response(answers, input_tokens=120):
    return od.DecisionResponse.model_validate(
        {
            "model": "gpt-6-luna",
            "answers": answers,
            "usage": {"input_tokens": input_tokens, "output_tokens": 0},
        }
    )


def choice(probabilities):
    top = max(probabilities, key=lambda k: probabilities[k])
    return {"type": "choice", "choice": top, "probabilities": probabilities, "confidence": 0.7}


def test_questions_become_decisions_questions():
    request = to_decisions(
        {
            "state": {"fen": "x"},
            "questions": {
                "move": Choice(instructions="Pick one.", criteria={"e2e4": "a pawn", "d2d4": None}),
                "eval": Score(instructions="How good?", criteria=["bad", "good"]),
                "tactic": Noul(
                    instructions="A tactic?",
                    criteria=NoulCriteria(true="a forcing move", false="quiet"),
                ),
                "plain": Noul(instructions="Plain?"),
                "half": Noul(instructions="Half?", criteria=NoulCriteria(true="yes")),
                "other_half": Noul(instructions="Other?", criteria=NoulCriteria(false="no")),
            },
        }
    )
    assert request["input"] == {"fen": "x"}
    questions = request["questions"]
    assert questions["move"] == od.Choice(
        instructions="Pick one.", choices={"e2e4": "a pawn", "d2d4": None}
    )
    assert questions["eval"] == od.Score(
        instructions="How good?", levels=[od.Level(label="bad"), od.Level(label="good")]
    )
    assert questions["tactic"] == od.Predicate(
        instructions="A tactic? Yes means: a forcing move No means: quiet"
    )
    assert questions["plain"] == od.Predicate(instructions="Plain?")
    assert questions["half"] == od.Predicate(instructions="Half? Yes means: yes")
    assert questions["other_half"] == od.Predicate(instructions="Other? No means: no")


def test_answers_become_typesafe_answers_and_a_refusal_is_dropped():
    score = {
        "type": "score",
        "score": 3.2,
        "legend": {0: "bad", 1: "good"},
        "probabilities": {0: 0.4, 1: 0.6},
        "confidence": 0.5,
    }
    out = from_decisions(
        response(
            {
                "move": choice({"e2e4": 0.8, "d2d4": 0.2}),
                "eval": score,
                "tactic": {"type": "predicate", "probability": 0.25},
                "other": {"type": "refusal"},
            }
        )
    )
    assert out.answers == {
        "move": ChoiceAnswer(
            type="choice", choice="e2e4", probabilities={"e2e4": 0.8, "d2d4": 0.2}, confidence=0.7
        ),
        "eval": ScoreAnswer(
            type="score",
            score=3.2,
            legend={0: "bad", 1: "good"},
            probabilities={0: 0.4, 1: 0.6},
            confidence=0.5,
        ),
        "tactic": NoulAnswer(type="noul", noul=0.25),
    }
    assert (out.model, out.usage.input_tokens, out.usage.output_tokens) == ("gpt-6-luna", 120, 0)


class FakeDecisions:
    """Stands in for `OpenAIDecisions`: answers the move question from a script."""

    def __init__(self, answer):
        self.answer = answer
        self.requests = []
        self.configs = []

    def _respond(self, request, config):
        self.requests.append(request)
        self.configs.append(config)
        (name, question) = next(iter(request["questions"].items()))
        return response({name: self.answer(list(question.choices))})

    def invoke(self, request, config=None):
        return self._respond(request, config)

    async def ainvoke(self, request, config=None):
        return self._respond(request, config)


def by_order(options):
    weights = range(len(options), 0, -1)
    total = sum(weights)
    return choice({uci: w / total for uci, w in zip(options, weights, strict=True)})


@pytest.mark.parametrize("sync", [True, False], ids=["sync", "async"])
async def test_the_ranker_ranks_every_move_in_one_decisions_request(sync):
    fake = FakeDecisions(by_order)
    ranker = GatewayRanker("openai/gpt-6-luna", client=DecisionsClassifier(fake))
    request = RankRequest(chess.STARTING_FEN, (), LEGAL, seed=0)
    result = ranker.rank(request) if sync else await ranker.arank(request)
    assert result.tournament is None
    assert [c.uci for c in result.candidates][:2] == list(LEGAL[:2])
    (call,) = result.calls
    assert call["model"] == "openai:gpt-6-luna"
    assert call["cost_usd"] == pytest.approx(120 * 0.10 / 1_000_000)
    assert fake.configs == [{"run_name": "systemone.rank"}]


def test_a_refused_move_fails_the_ranking():
    ranker = GatewayRanker(
        "openai/gpt-6-luna",
        client=DecisionsClassifier(FakeDecisions(lambda _: {"type": "refusal"})),
    )
    with pytest.raises(RankingFailed, match="malformed"):
        ranker.rank(RankRequest(chess.STARTING_FEN, (), LEGAL, seed=0))


def test_the_model_name_picks_the_client(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    decisions = classifier("openai/gpt-6-luna", timeout_s=7.0)
    assert isinstance(decisions, DecisionsClassifier)
    built = decisions.decisions
    assert (built.model, built.timeout, built.max_retries) == ("gpt-6-luna", 7.0, 0)
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")
    assert isinstance(classifier("typesafe/jev-latest", timeout_s=7.0), TypeSafeClassifier)
    assert default_max_options("openai/gpt-6-luna") == 255
