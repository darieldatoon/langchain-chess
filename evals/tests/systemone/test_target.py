from dataclasses import replace
from datetime import UTC, datetime

import chess

from langchain_chess.pricing import Tokens, make_call
from langchain_chess_evals.systemone.target import (
    failure_outputs,
    make_target,
    outputs_of,
    request_of,
)
from langchain_chess_systemone import Candidate, MoveDistribution, Tournament
from langchain_chess_systemone.testing import FakeRanker, distribution, failed

INPUTS = {"start_fen": chess.STARTING_FEN, "moves": ["e2e4"], "legal": ["e7e5", "d7d5", "g8f6"]}
AT = datetime(2026, 9, 26, tzinfo=UTC)


def call(input_tokens: int | None):
    return make_call("systemone", "fake", Tokens(input=input_tokens, output=3), AT)


def test_request_of_seeds_from_the_position():
    request = request_of(INPUTS)
    assert request.start_fen == chess.STARTING_FEN
    assert request.moves == ("e2e4",)
    assert request.options == ("e7e5", "d7d5", "g8f6")
    assert request_of(INPUTS).seed == request.seed
    assert request_of({**INPUTS, "moves": ["d2d4"]}).seed != request.seed


def test_outputs_of_a_single_ranking():
    d = distribution({"e7e5": 0.6, "d7d5": 0.3, "g8f6": 0.1}, confidence=0.7)
    outputs = outputs_of(d)
    assert outputs["ranked"][0] == {"uci": "e7e5", "probability": 0.6}
    assert outputs["margin"] == d.margin
    assert outputs["confidence"] == 0.7
    assert (outputs["tournament"], outputs["finalists"], outputs["heats"]) == (False, None, None)
    assert (outputs["requests"], outputs["input_tokens"], outputs["error"]) == (0, None, None)


def test_outputs_of_a_tournament():
    tournament = Tournament(max_options=2, rounds=2, finalists=["e7e5", "d7d5"], moves=[])
    d = MoveDistribution(
        candidates=(Candidate("e7e5", 0.7), Candidate("d7d5", 0.3)),
        confidence=0.5,
        model="fake",
        latency_ms=12.0,
        calls=(call(100), call(50)),
        tournament=tournament,
    )
    outputs = outputs_of(d)
    assert outputs["tournament"] is True
    assert outputs["finalists"] == ["e7e5", "d7d5"]
    assert outputs["heats"] == dict(tournament)
    assert (outputs["requests"], outputs["input_tokens"], outputs["output_tokens"]) == (2, 150, 6)
    # A call that reports no input tokens makes the total unknown
    assert outputs_of(replace(d, calls=(call(1), call(None))))["input_tokens"] is None


def test_failure_outputs():
    outputs = failure_outputs(failed("down", calls=[call(None)], elapsed_ms=40.0))
    assert outputs["ranked"] == []
    assert outputs["error"] == "down"
    assert (outputs["requests"], outputs["input_tokens"], outputs["latency_ms"]) == (1, None, 40.0)


async def test_make_target_ranks_the_legal_moves():
    ranker = FakeRanker([distribution({"d7d5": 0.9, "e7e5": 0.1}), failed()])
    target = make_target(ranker)
    assert (await target(INPUTS))["ranked"][0]["uci"] == "d7d5"
    assert ranker.requests[0] == request_of(INPUTS)
    assert (await target(INPUTS))["error"] == "ranker down"
