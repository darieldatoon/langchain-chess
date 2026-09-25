import chess
import pytest
from langchain_typesafe import TypeSafeClassifier
from langchain_typesafe.client import TypeSafeAPITimeoutError, TypeSafeRateLimitError

from langchain_chess_systemone import GatewayRanker, RankingFailed, RankRequest
from langchain_chess_systemone.ranker import backoff_seconds, default_max_options
from langchain_chess_systemone.testing import FakeTypeSafeClient, api_error, choice_answer

LEGAL = tuple(m.uci() for m in chess.Board().legal_moves)


def rank_request(options=LEGAL[:5], moves=(), seed=3):
    return RankRequest(start_fen=chess.STARTING_FEN, moves=tuple(moves), options=options, seed=seed)


@pytest.fixture(params=["sync", "async"])
def rank(request: pytest.FixtureRequest):
    async def call(ranker, req):
        if request.param == "sync":
            return ranker.rank(req)
        return await ranker.arank(req)

    return call


def ranker(client, **kwargs):
    return GatewayRanker(
        kwargs.pop("model", "semif-qwen3.5-4b"),
        client=client,
        sleep=lambda s: None,
        asleep=_nosleep,
        **kwargs,
    )


async def _nosleep(seconds):
    return None


async def test_a_single_ranking(rank):
    client = FakeTypeSafeClient()
    result = await rank(ranker(client), rank_request())
    assert [c.uci for c in result.candidates] == list(LEGAL[:5])
    assert result.tournament is None
    assert result.confidence == 0.4
    assert len(result.calls) == 1
    call = result.calls[0]
    assert call["model"] == "typesafe:semif-qwen3.5-4b"
    assert call["input_tokens"] is None
    assert call["cost_usd"] is None
    sent = client.requests[0]
    assert list(sent["questions"]) == ["move"]
    assert "Only some" not in sent["questions"]["move"].instructions
    assert sent["state"]["side_to_move"] == "white"


async def test_the_request_state_uses_recent_san(rank):
    client = FakeTypeSafeClient()
    board = chess.Board()
    for uci in ("e2e4", "e7e5"):
        board.push_uci(uci)
    options = tuple(m.uci() for m in board.legal_moves)[:3]
    await rank(ranker(client), RankRequest(chess.STARTING_FEN, ("e2e4", "e7e5"), options, 0))
    state = client.requests[0]["state"]
    assert state["recent_moves_san"] == ["e4", "e5"]
    assert state["material"]["for_side_to_move"] == 0
    assert state["fen"] == board.fen()


async def test_black_to_move_material_is_from_blacks_side(rank):
    client = FakeTypeSafeClient()
    fen = "r6k/8/8/8/8/8/8/Q6K b - - 0 1"
    board = chess.Board(fen)
    options = tuple(m.uci() for m in board.legal_moves)[:2]
    await rank(ranker(client, history_plies=0), RankRequest(fen, (), options, 0))
    state = client.requests[0]["state"]
    assert state["material"]["for_side_to_move"] == -4
    assert state["recent_moves_san"] == []


async def test_one_option_needs_no_request(rank):
    client = FakeTypeSafeClient()
    result = await rank(ranker(client), rank_request(options=("e2e4",)))
    assert (result.top.uci, result.top.probability, result.confidence) == ("e2e4", 1.0, 1.0)
    assert result.calls == ()
    assert client.requests == []


async def test_more_options_than_the_cap_run_a_tournament(rank):
    client = FakeTypeSafeClient()
    result = await rank(
        ranker(client, with_eval=True, with_nouls=True), rank_request(options=LEGAL)
    )
    assert len(client.requests) == 2
    heats, final = client.requests
    assert list(heats["questions"]) == ["heat_1_1", "heat_1_2"]
    assert set(final["questions"]) == {"move", "eval", "needs_calculation", "tactics_present"}
    assert "Only some" in final["questions"]["move"].instructions
    assert len(result.candidates) == 16
    assert result.tournament is not None
    assert result.eval_score == 4.2
    assert result.needs_calculation == 0.25
    assert len(result.calls) == 2


async def test_transient_errors_are_retried(rank):
    client = FakeTypeSafeClient(errors=[TypeSafeAPITimeoutError(1.0)])
    result = await rank(ranker(client), rank_request())
    assert len(client.requests) == 2
    assert len(result.calls) == 1


async def test_exhausted_retries_fail_with_the_completed_calls(rank):
    rate = api_error(429, TypeSafeRateLimitError)
    client = FakeTypeSafeClient(errors=[])
    ranking = ranker(client, max_attempts=2)
    # The heat request succeeds; the final keeps failing.
    original = client._respond

    def respond(req):
        if "move" in req["questions"]:
            raise rate
        return original(req)

    client._respond = respond
    with pytest.raises(RankingFailed, match="failed after 2 attempts") as caught:
        await rank(ranking, rank_request(options=LEGAL))
    assert len(caught.value.calls) == 1


async def test_other_errors_fail_immediately(rank):
    client = FakeTypeSafeClient(errors=[api_error(422)])
    with pytest.raises(RankingFailed, match="invalid SemIf request") as caught:
        await rank(ranker(client), rank_request())
    assert caught.value.calls == ()
    assert len(client.requests) == 1


async def test_malformed_answers_fail_but_keep_the_call(rank):
    client = FakeTypeSafeClient(answer=lambda name, options: {options[0]: 6.0, options[1]: 2.5})
    with pytest.raises(RankingFailed, match="malformed") as caught:
        await rank(ranker(client), rank_request())
    assert len(caught.value.calls) == 1


async def test_a_missing_choice_is_malformed(rank):
    client = FakeTypeSafeClient()
    original = client._respond

    def respond(req):
        response = original(req)
        response.answers.pop("move")
        return response

    client._respond = respond
    with pytest.raises(RankingFailed, match="no Choice answer"):
        await rank(ranker(client), rank_request())


async def test_jev_is_priced(rank):
    client = FakeTypeSafeClient(
        semif=False,
        input_tokens=1000,
        output_tokens=3,
        model="jev-1.13.0",
        answer=lambda name, options: choice_answer(dict.fromkeys(options, 1 / len(options))),
    )
    result = await rank(ranker(client, model="typesafe/jev-latest"), rank_request(options=LEGAL))
    assert len(client.requests) == 1
    assert result.calls[0]["cost_usd"] == pytest.approx(0.000042)
    assert result.calls[0]["model"] == "typesafe:jev-latest"


def test_max_options():
    assert default_max_options("semif-qwen3.5-4b") == 16
    assert default_max_options("typesafe/jev-latest") == 255
    assert default_max_options("mystery") == 16
    assert ranker(FakeTypeSafeClient(), max_options=2).max_options == 2
    with pytest.raises(ValueError, match="max_options"):
        ranker(FakeTypeSafeClient(), max_options=1)
    assert backoff_seconds(0) == 0.5
    assert backoff_seconds(10) == 4.0


def test_the_default_client_is_built_on_first_use(monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")
    monkeypatch.setenv("TYPESAFE_BASE_URL", "https://gateway.smith.langchain.com")
    ranking = GatewayRanker("semif-qwen3.5-4b")
    assert ranking._client is None
    client = ranking.client
    assert isinstance(client, TypeSafeClassifier)
    assert ranking.client is client
    assert client.base_url == "https://gateway.smith.langchain.com"
