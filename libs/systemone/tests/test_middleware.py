import dataclasses

import chess
import pytest
from langgraph.checkpoint.memory import InMemorySaver

from langchain_chess import ChessMiddleware, create_chess_agent
from langchain_chess.testing import ScriptedModel, position, topology
from langchain_chess_systemone import GatewayRanker, NoSystemOne, SystemOneMiddleware
from langchain_chess_systemone.middleware import turn_seed
from langchain_chess_systemone.testing import (
    FakeRanker,
    FakeTypeSafeClient,
    distribution,
    failed,
)

# 1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5: White has 33 legal moves.
ITALIAN = "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"
ITALIAN_MOVES = tuple(m.uci() for m in chess.Board(ITALIAN).legal_moves)
META = "SystemOneMiddleware"


@pytest.fixture(params=["sync", "async"])
def run(request):
    async def invoke(agent, payload, config):
        if request.param == "sync":
            return agent.invoke(payload, config)
        return await agent.ainvoke(payload, config)

    return invoke


@pytest.fixture
def cfg(request):
    return {"configurable": {"thread_id": request.node.name}}


def agent(model, *middleware, **kwargs):
    kwargs.setdefault("checkpointer", InMemorySaver())
    return create_chess_agent(model, middleware=list(middleware), **kwargs)


def gateway(client=None, **kwargs):
    async def nosleep(seconds):
        return None

    return GatewayRanker(
        kwargs.pop("model", "semif-qwen3.5-4b"),
        client=client or FakeTypeSafeClient(),
        sleep=lambda s: None,
        asleep=nosleep,
        **kwargs,
    )


class Pruner(ChessMiddleware):
    def __init__(self, keep, label="Pruner"):
        self.keep = keep
        self.label = label

    @property
    def name(self):
        return self.label

    def before_model(self, state, runtime):
        return self.narrow(state, self.keep)

    async def abefore_model(self, state, runtime):
        return self.narrow(state, self.keep)


SPLIT = distribution({"e2e4": 0.60, "d2d4": 0.25, "g1f3": 0.15})


async def test_no_systemone_keeps_the_graph_and_leaves_the_move_to_the_model(run, cfg):
    model = ScriptedModel(script=["MOVE: e4"])
    off = agent(model, NoSystemOne())
    on = agent(model, SystemOneMiddleware("fake", ranker=FakeRanker([])))
    assert topology(off) == topology(on)
    out = await run(off, position(), cfg)
    assert (out["plies"][0]["source"], out["plies"][0]["meta"]) == ("llm", {})


async def test_the_frozen_shortlist_is_replayed_and_never_regated(run, cfg):
    ranker = FakeRanker([SPLIT])
    model = ScriptedModel(script=["MOVE: Qh5", "MOVE: d4"])
    systemone = SystemOneMiddleware("fake", threshold=0.40, k=2, ranker=ranker)
    out = await run(agent(model, systemone), position(), cfg)
    assert len(ranker.requests) == 1
    assert out["moves"] == ["d2d4"]
    assert out["plies"][0]["source"] == "llm"
    for request in model.requests:
        assert "Suggested candidates: e4, d4." in request[-1].content
    meta = out["plies"][0]["meta"][META]
    assert meta["status"] == "shortlist"
    assert meta["followed"] is True
    assert meta["signal"] == pytest.approx(0.35)
    assert meta["played_move_result"] == [
        {"round": 1, "heat": None, "rank": 2, "probability": 0.25, "bye": False}
    ]


async def test_an_unfollowed_suggestion_records_the_played_rank(run, cfg):
    model = ScriptedModel(script=["MOVE: Nf3"])
    systemone = SystemOneMiddleware("fake", k=2, ranker=FakeRanker([SPLIT]))
    out = await run(agent(model, systemone), position(), cfg)
    meta = out["plies"][0]["meta"][META]
    assert meta["followed"] is False
    assert meta["played_move_result"][0]["rank"] == 3
    assert meta["played_move_result"][0]["probability"] == 0.15
    assert [m["uci"] for m in meta["shortlist"]] == ["e2e4", "d2d4"]
    assert out["turns"][0]["status"] == "committed"


async def test_a_one_move_shortlist_is_not_a_forced_move(run, cfg):
    model = ScriptedModel(script=["MOVE: Qh5", "MOVE: Nf3"])
    systemone = SystemOneMiddleware("fake", k=1, ranker=FakeRanker([SPLIT]))
    out = await run(agent(model, systemone), position(), cfg)
    assert model.calls == 2
    assert out["plies"][0]["source"] == "llm"
    assert out["moves"] == ["g1f3"]


@pytest.mark.parametrize("gate", ["margin", "confidence"])
async def test_both_signals_are_recorded(run, cfg, gate):
    model = ScriptedModel(script=["MOVE: e4"])
    systemone = SystemOneMiddleware("fake", gate=gate, k=1, ranker=FakeRanker([SPLIT]))
    out = await run(agent(model, systemone), position(), cfg)
    meta = out["plies"][0]["meta"][META]
    assert meta["confidence"] == 0.5
    assert meta["margin"] == pytest.approx(0.35)
    assert meta["signal"] == (meta["margin"] if gate == "margin" else meta["confidence"])
    assert meta["gate"] == gate


def malformed(kind):
    def answer(name, options):
        a, b, c = options[:3]
        return {
            "negative": {a: 1.2, b: -0.2},
            "nan": {a: float("nan"), b: 1.0},
            "zero": dict.fromkeys(options, 0.0),
            "unnormalized": {a: 6.0, b: 2.5, c: 1.5},
        }[kind]

    return answer


@pytest.mark.parametrize("kind", ["negative", "nan", "zero", "unnormalized"])
async def test_malformed_distributions(run, cfg, kind):
    client = FakeTypeSafeClient(answer=malformed(kind))
    model = ScriptedModel(script=["MOVE: e4"])
    systemone = SystemOneMiddleware("semif-qwen3.5-4b", ranker=gateway(client))
    out = await run(agent(model, systemone), position(), cfg)
    meta = out["plies"][0]["meta"][META]
    assert meta["status"] == "skipped"
    assert "malformed" in meta["error"]
    assert meta["followed"] is None
    assert meta["played_move_result"] is None
    assert "Suggested" not in model.requests[0][-1].content
    # The completed (malformed) request is still on the turn.
    assert [c["kind"] for c in out["turns"][0]["calls"]] == ["llm", "systemone"]

    alone = SystemOneMiddleware(
        "semif-qwen3.5-4b", threshold=0.0, has_model=False, ranker=gateway(client)
    )
    lonely = agent(None, alone)
    with pytest.raises(Exception, match="malformed"):
        await run(lonely, position(), cfg)
    assert lonely.get_state(cfg).values["turns"][-1]["status"] == "pending"


async def test_a_later_restriction_hides_stale_suggestions(run, cfg):
    model = ScriptedModel(script=["MOVE: Nf3"])
    systemone = SystemOneMiddleware("fake", k=2, ranker=FakeRanker([SPLIT]))
    out = await run(agent(model, systemone, Pruner(["g1f3"])), position(), cfg)
    prompt = model.requests[0][-1].content
    assert "Suggested" not in prompt
    assert "Only these moves are permitted: Nf3." in prompt
    assert out["moves"] == ["g1f3"]


async def test_two_move_orders_to_one_fen_are_ranked_separately(run):
    ranker = FakeRanker(lambda request: distribution(dict.fromkeys(request.options[:2], 0.5)))
    shared = agent(
        ScriptedModel(script=["MOVE: Nc6", "MOVE: Nc6"]), SystemOneMiddleware("fake", ranker=ranker)
    )
    first = await run(
        shared, position(["e2e3", "e7e6", "d2d3"]), {"configurable": {"thread_id": "a"}}
    )
    second = await run(
        shared, position(["d2d3", "e7e6", "e2e3"]), {"configurable": {"thread_id": "b"}}
    )
    assert chess.Board(first["start_fen"]).fen() == chess.Board(second["start_fen"]).fen()
    assert len(ranker.requests) == 2
    assert ranker.requests[0].moves != ranker.requests[1].moves
    assert ranker.requests[0].seed != ranker.requests[1].seed


async def test_threshold_zero_without_a_model_plays_the_top_move(run, cfg):
    systemone = SystemOneMiddleware(
        "fake", threshold=0.0, has_model=False, ranker=FakeRanker([SPLIT])
    )
    out = await run(agent(None, systemone), position(), cfg)
    ply = out["plies"][0]
    assert (ply["uci"], ply["source"], ply["model"]) == ("e2e4", "systemone", "fake")
    assert out["messages"][-1].content == "MOVE: e4"
    meta = ply["meta"][META]
    assert meta["status"] == "played"
    assert meta["followed"] is None
    assert meta["played_move_result"][0]["rank"] == 1
    # Shown even though System 1 played: its whole ranking, best first.
    assert [(m["uci"], m["probability"]) for m in meta["top"]] == [
        ("e2e4", 0.6),
        ("d2d4", 0.25),
        ("g1f3", 0.15),
    ]


async def test_a_confident_ranking_plays_and_skips_the_model(run, cfg):
    model = ScriptedModel(script=[])
    confident = distribution({"e2e4": 0.97, "d2d4": 0.03})
    systemone = SystemOneMiddleware("fake", threshold=0.9, ranker=FakeRanker([confident]))
    out = await run(agent(model, systemone), position(), cfg)
    assert out["plies"][0]["source"] == "systemone"
    assert model.calls == 0


async def test_a_rounded_away_shortfall_cannot_clear_the_margin_gate(run, cfg):
    # Jev rounds 0.85 plus 32 x (0.15 / 32) to 0.85 plus zeros; the true margin is below 0.9.
    client = FakeTypeSafeClient(
        answer=lambda name, options: {"c4f7": 0.85}, semif=False, model="typesafe/jev-1"
    )
    model = ScriptedModel(script=["MOVE: O-O"])
    systemone = SystemOneMiddleware(
        "typesafe/jev-1", threshold=0.9, ranker=gateway(client, model="typesafe/jev-1")
    )
    out = await run(agent(model, systemone), position(start_fen=ITALIAN), cfg)
    meta = out["plies"][0]["meta"][META]
    assert meta["status"] == "shortlist"
    assert meta["margin"] == pytest.approx(0.85)
    assert out["plies"][0]["source"] == "llm"
    assert model.calls == 1


async def test_threshold_one_never_plays(run, cfg):
    model = ScriptedModel(script=["MOVE: d4"])
    certain = distribution({"e2e4": 1.0, "d2d4": 0.0}, confidence=1.0)
    systemone = SystemOneMiddleware("fake", threshold=1.0, ranker=FakeRanker([certain]))
    out = await run(agent(model, systemone), position(), cfg)
    assert out["plies"][0]["source"] == "llm"


async def test_a_thirty_move_tournament(run, cfg):
    options = ITALIAN_MOVES[:30]
    client = FakeTypeSafeClient()
    systemone = SystemOneMiddleware(
        "semif-qwen3.5-4b",
        threshold=0.95,
        tournament_threshold=0.005,
        with_eval=True,
        ranker=gateway(client, with_eval=True),
    )
    out = await run(
        agent(ScriptedModel(script=[]), systemone),
        position(start_fen=ITALIAN, restrict=options),
        cfg,
    )
    heats, final = client.requests
    assert [len(q.criteria) for q in heats["questions"].values()] == [15, 15]
    assert set(final["questions"]) == {"move", "eval"}
    assert len(final["questions"]["move"].criteria) == 16
    ply = out["plies"][0]
    meta = ply["meta"][META]
    assert ply["source"] == "systemone"
    assert meta["threshold_used"] == 0.005
    assert meta["finalist_conditional"] is True
    assert meta["tournament"]["rounds"] == 2
    assert meta["eval_score"] == 4.2
    stages = meta["played_move_result"]
    assert [s["heat"] for s in stages][-1] is None
    assert [c["kind"] for c in out["turns"][0]["calls"]] == ["systemone", "systemone"]


async def test_tournament_candidates_are_finalists_only(run, cfg):
    options = ITALIAN_MOVES[:30]
    client = FakeTypeSafeClient()
    model = ScriptedModel(script=["MOVE: O-O"])
    systemone = SystemOneMiddleware(
        "semif-qwen3.5-4b", threshold=0.0, tournament_threshold=1.0, k=255, ranker=gateway(client)
    )
    out = await run(agent(model, systemone), position(start_fen=ITALIAN, restrict=options), cfg)
    meta = out["plies"][0]["meta"][META]
    finalists = meta["tournament"]["finalists"]
    assert [m["uci"] for m in meta["shortlist"]] == [
        m["uci"] for m in meta["shortlist"] if m["uci"] in finalists
    ]
    assert len(meta["shortlist"]) == 16
    assert len(meta["top"]) == 5
    assert all(m["uci"] in finalists for m in meta["top"])
    assert meta["threshold_used"] == 1.0
    castle = "e1g1"
    if castle not in finalists:
        assert meta["played_move_result"][-1]["heat"] is not None


async def test_the_tournament_threshold_defaults_to_the_threshold(run, cfg):
    options = ITALIAN_MOVES[:30]
    systemone = SystemOneMiddleware(
        "semif-qwen3.5-4b", threshold=0.0, has_model=False, ranker=gateway()
    )
    out = await run(agent(None, systemone), position(start_fen=ITALIAN, restrict=options), cfg)
    assert out["plies"][0]["meta"][META]["threshold_used"] == 0.0


async def test_a_cap_of_two_with_three_moves(run, cfg):
    client = FakeTypeSafeClient()
    systemone = SystemOneMiddleware(
        "semif-qwen3.5-4b", threshold=0.0, has_model=False, ranker=gateway(client, max_options=2)
    )
    out = await run(agent(None, systemone), position(restrict=["e2e4", "d2d4", "g1f3"]), cfg)
    assert [len(q.criteria) for r in client.requests for q in r["questions"].values()] == [2, 2]
    moves = out["plies"][0]["meta"][META]["tournament"]["moves"]
    assert sum(m["stages"][0]["bye"] for m in moves) == 1


async def test_a_cap_of_four_with_twenty_moves(run, cfg):
    client = FakeTypeSafeClient()
    systemone = SystemOneMiddleware(
        "semif-qwen3.5-4b", threshold=0.0, has_model=False, ranker=gateway(client, max_options=4)
    )
    out = await run(agent(None, systemone), position(), cfg)
    assert out["plies"][0]["source"] == "systemone"
    assert all(2 <= len(q.criteria) <= 4 for r in client.requests for q in r["questions"].values())


async def test_a_failed_final_keeps_the_heat_call(run, cfg):
    client = FakeTypeSafeClient()
    original = client._respond

    def respond(request):
        if "move" in request["questions"]:
            raise RuntimeError("final failed")
        return original(request)

    client._respond = respond
    model = ScriptedModel(script=["MOVE: O-O"])
    systemone = SystemOneMiddleware("semif-qwen3.5-4b", ranker=gateway(client))
    out = await run(agent(model, systemone), position(start_fen=ITALIAN), cfg)
    meta = out["plies"][0]["meta"][META]
    assert meta["status"] == "skipped"
    assert "final failed" in meta["error"]
    assert [c["kind"] for c in out["turns"][0]["calls"]] == ["llm", "systemone"]


@pytest.mark.parametrize(("threshold", "source"), [(0.9, "systemone"), (1.0, "llm")])
async def test_narrowed_to_one_move_ranks_locally(run, cfg, threshold, source):
    ranker = gateway(FakeTypeSafeClient())
    model = ScriptedModel(script=["MOVE: e4"])
    systemone = SystemOneMiddleware("semif-qwen3.5-4b", threshold=threshold, ranker=ranker)
    out = await run(agent(model, Pruner(["e2e4"]), systemone), position(), cfg)
    assert ranker.client.requests == []
    assert out["plies"][0]["source"] == source
    assert out["turns"][0]["calls"][-1:] == [] or out["turns"][0]["calls"][-1]["kind"] == "llm"


async def test_a_tournament_is_not_rerun_on_retry(run, cfg):
    client = FakeTypeSafeClient()
    model = ScriptedModel(script=["MOVE: Qh5", "MOVE: O-O"])
    systemone = SystemOneMiddleware("semif-qwen3.5-4b", threshold=1.0, ranker=gateway(client))
    out = await run(agent(model, systemone), position(start_fen=ITALIAN), cfg)
    assert len(client.requests) == 2
    assert out["moves"][-1] == "e1g1"
    assert "Suggested candidates" in model.requests[1][-1].content


async def test_a_failure_with_a_model_is_skipped_and_without_raises(run, cfg):
    model = ScriptedModel(script=["MOVE: e4"])
    calls = [{"kind": "systemone", "cost_usd": None}]
    systemone = SystemOneMiddleware("fake", ranker=FakeRanker([failed("down", calls)]))
    out = await run(agent(model, systemone), position(), cfg)
    assert out["plies"][0]["meta"][META]["error"] == "down"
    assert out["turns"][0]["calls"][-1] == calls[0]

    alone = agent(
        None,
        SystemOneMiddleware(
            "fake", threshold=0.0, has_model=False, ranker=FakeRanker([failed("down")])
        ),
    )
    with pytest.raises(Exception, match="down"):
        await run(alone, position(), cfg)


async def test_a_played_move_is_reproposed_after_a_failed_commit(run, cfg):
    from langchain.agents.middleware.types import AgentMiddleware

    class FailOnce(AgentMiddleware):
        failed = False

        def after_agent(self, state, runtime):
            if not FailOnce.failed:
                FailOnce.failed = True
                raise RuntimeError("commit failed")

        async def aafter_agent(self, state, runtime):
            self.after_agent(state, runtime)

    ranker = FakeRanker([SPLIT])
    systemone = SystemOneMiddleware("fake", threshold=0.0, has_model=False, ranker=ranker)
    lonely = agent(None, FailOnce(), systemone)
    with pytest.raises(RuntimeError):
        await run(lonely, position(), cfg)
    out = await run(lonely, {}, cfg)
    assert out["moves"] == ["e2e4"]
    assert len(ranker.requests) == 1
    FailOnce.failed = False


def test_replay_writes_only_what_is_still_allowed():
    systemone = SystemOneMiddleware("fake", k=2, ranker=FakeRanker([]))
    frozen = systemone._freeze(SPLIT, "t1")
    view = systemone.position(
        {
            "start_fen": chess.STARTING_FEN,
            "moves": [],
            "allowed_moves": ["g1f3"],
            "turns": [{"id": "t1", "initial_allowed": ["e2e4", "d2d4", "g1f3"]}],
        }
    )
    assert systemone._replay(frozen, view) == {"candidates": []}
    played = {**frozen, "status": "played", "played": "e2e4"}
    assert systemone._replay(played, view) == {}
    assert systemone.ply_meta({"turns": [{"id": "other"}], "systemone_turn": frozen}) is None
    assert systemone.turn_calls({"turns": [], "systemone_turn": frozen}) == []


def test_top_p_shortlists():
    systemone = SystemOneMiddleware("fake", k=3, top_p=0.8, ranker=FakeRanker([]))
    assert [c.uci for c in systemone._shortlist(SPLIT.candidates)] == ["e2e4", "d2d4"]
    wide = SystemOneMiddleware("fake", k=2, top_p=1.0, ranker=FakeRanker([]))
    assert [c.uci for c in wide._shortlist(SPLIT.candidates)] == ["e2e4", "d2d4"]


def test_argument_validation():
    for kwargs in (
        {"k": 0},
        {"k": 256},
        {"top_p": 0.0},
        {"threshold": 1.5},
        {"tournament_threshold": -0.1},
    ):
        with pytest.raises(ValueError, match="must be within"):
            SystemOneMiddleware("fake", ranker=FakeRanker([]), **kwargs)
    assert isinstance(SystemOneMiddleware("semif-qwen3.5-4b").ranker, GatewayRanker)


def test_turn_seed_is_stable_and_turn_specific():
    assert turn_seed(0, "a") == turn_seed(0, "a")
    assert turn_seed(0, "a") != turn_seed(1, "a")
    assert turn_seed(0, "a") != turn_seed(0, "b")


def test_the_agent_seed_reaches_systemone():
    systemone = SystemOneMiddleware("fake", ranker=FakeRanker([]))
    create_chess_agent(ScriptedModel(script=[]), middleware=[systemone], seed=42)
    assert systemone.agent_seed == 42


async def test_a_skipped_decision_is_replayed_as_nothing(run, cfg):
    model = ScriptedModel(script=["MOVE: Qh5", "MOVE: e4"])
    systemone = SystemOneMiddleware("fake", ranker=FakeRanker([failed("down")]))
    out = await run(agent(model, systemone), position(), cfg)
    assert out["moves"] == ["e2e4"]
    assert all("Suggested" not in r[-1].content for r in model.requests)


def test_played_result_for_a_move_that_was_not_an_option():
    systemone = SystemOneMiddleware("fake", ranker=FakeRanker([]))
    frozen = systemone._freeze(SPLIT, "t1")
    assert systemone._played_result(frozen, "a2a3") is None
    tournament = {"max_options": 2, "rounds": 1, "finalists": [], "moves": []}
    assert systemone._played_result({**frozen, "tournament": tournament}, "a2a3") is None


def test_fakes_enforce_semif_limits():
    from langchain_typesafe import Choice

    from langchain_chess_systemone.types import MoveDistribution

    client = FakeTypeSafeClient()
    many = {f"q{i}": Choice(instructions="x", criteria={"a": "a", "b": "b"}) for i in range(33)}
    with pytest.raises(Exception, match="invalid SemIf request"):
        client.invoke({"state": {}, "questions": many})
    one = {"q": Choice(instructions="x", criteria={"a": "a"})}
    with pytest.raises(Exception, match="invalid SemIf request"):
        client.invoke({"state": {}, "questions": one})
    with pytest.raises(ValueError, match="at least one candidate"):
        MoveDistribution(candidates=(), confidence=1.0, model="m", latency_ms=0.0, calls=())


SLOW = distribution({"e2e4": 0.60, "d2d4": 0.25, "g1f3": 0.15}, latency_ms=1234.0)


async def test_a_system_one_move_carries_its_ranking_time(run, cfg):
    systemone = SystemOneMiddleware(
        "fake", threshold=0.0, has_model=False, ranker=FakeRanker([SLOW])
    )
    out = await run(agent(None, systemone), position(), cfg)
    assert out["plies"][0]["source"] == "systemone"
    assert out["plies"][0]["latency_ms"] == 1234.0
    assert out["turns"][0]["latency_ms"] == 1234.0


async def test_a_hybrid_turn_counts_the_ranking_once_across_retries(run, cfg):
    model = ScriptedModel(script=[RuntimeError("down"), "MOVE: Qh5", "MOVE: e4"])
    systemone = SystemOneMiddleware("fake", ranker=FakeRanker([SLOW]))
    chess_agent = agent(model, systemone)
    with pytest.raises(RuntimeError, match="down"):
        await run(chess_agent, position(), cfg)
    out = await run(chess_agent, {}, cfg)
    assert out["plies"][0]["source"] == "llm"
    latency = out["plies"][0]["latency_ms"]
    assert 1234.0 < latency < 2 * 1234.0
    assert out["turns"][0]["latency_ms"] == latency


async def test_a_skipped_ranking_carries_the_time_it_took(run, cfg):
    model = ScriptedModel(script=["MOVE: e4"])
    systemone = SystemOneMiddleware("fake", ranker=FakeRanker([failed(elapsed_ms=400.0)]))
    out = await run(agent(model, systemone), position(), cfg)
    ply = out["plies"][0]
    assert ply["meta"][META]["status"] == "skipped"
    assert ply["meta"][META]["latency_ms"] == 400.0
    assert 400.0 < ply["latency_ms"] < 800.0


CALL = {"kind": "systemone", "model": "fake", "cost_usd": 0.0001, "cost_complete": True}
PRICED = dataclasses.replace(SPLIT, calls=(CALL,), latency_ms=400.0)
LIVE_ONLY = {"turn_id", "calls"}
META_ONLY = {"followed", "played_move_result"}


@pytest.mark.parametrize(
    ("threshold", "script", "status"),
    [
        (0.0, [PRICED], "played"),
        (0.9, [PRICED], "shortlist"),
        (0.9, [failed("down", [CALL], 300.0)], "skipped"),
    ],
)
async def test_the_decision_is_public_as_soon_as_it_is_made(run, cfg, threshold, script, status):
    model = ScriptedModel(script=["MOVE: e4"])
    systemone = SystemOneMiddleware("fake", threshold=threshold, ranker=FakeRanker(script))
    out = await run(agent(model, systemone), position(), cfg)
    live = out["systemone_live"]
    assert live["turn_id"] == out["turns"][0]["id"]
    assert live["status"] == status
    assert live["calls"] == [CALL]
    meta = out["plies"][0]["meta"][META]
    assert set(live) - LIVE_ONLY == set(meta) - META_ONLY
    assert {k: live[k] for k in set(live) - LIVE_ONLY} == {
        k: meta[k] for k in set(meta) - META_ONLY
    }
    # The calls join the turn once, when it finalizes.
    assert out["turns"][0]["calls"].count(CALL) == 1


def test_the_live_decision_is_output_but_never_input():
    built = agent(ScriptedModel(script=[]), SystemOneMiddleware("fake", ranker=FakeRanker([])))
    assert "systemone_live" in built.get_output_jsonschema()["properties"]
    assert "systemone_live" not in built.get_input_jsonschema()["properties"]
    assert "systemone_turn" not in built.get_output_jsonschema()["properties"]


async def test_a_retry_replays_the_decision_without_rewriting_it(run, cfg):
    model = ScriptedModel(script=[RuntimeError("down"), "MOVE: e4"])
    ranker = FakeRanker([PRICED])
    chess_agent = agent(model, SystemOneMiddleware("fake", ranker=ranker))
    with pytest.raises(RuntimeError, match="down"):
        await run(chess_agent, position(), cfg)
    before = chess_agent.get_state(cfg).values["systemone_live"]
    assert before["status"] == "shortlist"
    out = await run(chess_agent, {}, cfg)
    assert out["systemone_live"] == before
    assert len(ranker.requests) == 1


def test_a_replayed_decision_writes_no_live_payload():
    systemone = SystemOneMiddleware("fake", k=2, ranker=FakeRanker([]))
    state = {
        "start_fen": chess.STARTING_FEN,
        "moves": [],
        "allowed_moves": ["e2e4", "d2d4", "g1f3"],
        "turns": [{"id": "t1", "initial_allowed": ["e2e4", "d2d4", "g1f3"]}],
        "systemone_turn": systemone._freeze(SPLIT, "t1"),
    }
    assert systemone.before_model(state, None) == {
        "fallback_move": "e2e4",
        "candidates": ["e2e4", "d2d4"],
    }
