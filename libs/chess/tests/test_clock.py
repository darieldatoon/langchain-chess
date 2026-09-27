import pytest
from langchain_core.messages import AIMessage

from langchain_chess.testing import ScriptedModel, human, position

CONTROL = {"base_ms": 600_000, "increment_ms": 5_000}
# White to move with a queen against a bare king: Black can't mate.
BARE_BLACK = "4k3/8/8/8/8/8/8/Q3K3 w - - 0 1"


def clock(white_ms=600_000, black_ms=600_000, control=CONTROL):
    return {"control": control, "white_ms": white_ms, "black_ms": black_ms}


class Wall:
    """A wall clock the scripted model moves on, standing in for time spent thinking."""

    def __init__(self) -> None:
        self.at = 1_000.0

    def __call__(self) -> float:
        return self.at

    def think(self, seconds: float, reply: str = "MOVE: e5"):
        def step(_messages):
            self.at += seconds
            return reply

        return step


@pytest.fixture
def wall():
    return Wall()


async def test_an_untimed_game_records_no_clock(make_agent, run, cfg):
    out = await run(make_agent(ScriptedModel(script=["MOVE: e5"])), human("e4"), cfg)
    assert out["time_control"] is None
    assert [p["clock_ms"] for p in out["plies"]] == [None, None]


async def test_each_ply_records_the_movers_time_left(make_agent, run, cfg, wall):
    agent = make_agent(ScriptedModel(script=[wall.think(2.5)]), now=wall)
    out = await run(agent, {**human("e4"), "clock": clock(white_ms=605_000)}, cfg)
    assert out["time_control"] == CONTROL
    assert [p["clock_ms"] for p in out["plies"]] == [605_000, 600_000 - 2_500 + 5_000]
    assert "clock" not in out


async def test_a_move_after_the_flag_loses_on_time(make_agent, run, cfg, wall):
    agent = make_agent(ScriptedModel(script=[wall.think(3)]), now=wall)
    out = await run(agent, {**human("e4"), "clock": clock(black_ms=2_000)}, cfg)
    assert out["outcome"] == {"kind": "timeout", "winner": "white"}
    assert out["moves"] == ["e2e4"]
    assert out["turns"][-1]["status"] == "terminal"
    assert out["messages"][-1].content == "Black runs out of time. 1-0"


async def test_a_flag_against_a_bare_king_is_a_draw(make_agent, run, cfg, wall):
    agent = make_agent(ScriptedModel(script=[wall.think(3, "MOVE: Kd2")]), now=wall)
    out = await run(agent, {**position(start_fen=BARE_BLACK), "clock": clock(white_ms=1)}, cfg)
    assert out["outcome"] == {"kind": "draw", "reason": "timeout_vs_insufficient_material"}


async def test_a_resignation_after_the_flag_is_a_loss_on_time(make_agent, run, cfg, wall):
    agent = make_agent(
        ScriptedModel(script=["MOVE: Kxe2", "nope", wall.think(2, "no")]),
        now=wall,
        max_retries=2,
    )
    out = await run(agent, {**human("e4"), "clock": clock(black_ms=1_000)}, cfg)
    assert out["outcome"] == {"kind": "timeout", "winner": "white"}


async def test_the_human_flags(make_agent, run, cfg):
    agent = make_agent(ScriptedModel(script=["MOVE: e5"]))
    await run(agent, {**human("e4"), "clock": clock()}, cfg)
    out = await run(agent, {"clock": clock(white_ms=0), "flag": "white"}, cfg)
    assert out["outcome"] == {"kind": "timeout", "winner": "black"}
    assert out["messages"][-1].content == "White runs out of time. 0-1"
    assert out["error"] is None
    assert agent.get_state(cfg).values["flag"] is None


async def test_the_agent_flags_on_a_failed_turn(make_agent, run, cfg):
    agent = make_agent(ScriptedModel(script=[RuntimeError("provider down")]))
    with pytest.raises(RuntimeError, match="provider down"):
        await run(agent, {**human("e4"), "clock": clock()}, cfg)
    out = await run(agent, {"clock": clock(black_ms=-40), "flag": "black"}, cfg)
    assert out["outcome"] == {"kind": "timeout", "winner": "white"}
    assert out["turns"][-1]["status"] == "terminal"
    assert out["plies"][-1]["side"] == "white"


async def test_a_retry_charges_from_the_clock_it_carries(make_agent, run, cfg, wall):
    model = ScriptedModel(script=[RuntimeError("provider down"), wall.think(1)])
    agent = make_agent(model, now=wall)
    with pytest.raises(RuntimeError):
        await run(agent, {**human("e4"), "clock": clock()}, cfg)
    wall.at += 3_600  # waiting on Retry is paused: the client's clock says so
    out = await run(agent, {"clock": clock(black_ms=500_000)}, cfg)
    assert out["plies"][-1]["clock_ms"] == 500_000 - 1_000 + 5_000


async def test_a_position_stamps_only_each_sides_latest_move(make_agent, run, cfg):
    agent = make_agent(ScriptedModel(script=["MOVE: Bc4"]))
    moves = ["e2e4", "e7e5", "g1f3", "b8c6"]
    out = await run(agent, {**position(moves), "clock": clock(white_ms=7, black_ms=9)}, cfg)
    assert [p["clock_ms"] for p in out["plies"][:4]] == [None, None, 7, 9]


async def test_a_forced_move_is_timed_too(make_agent, run, cfg):
    agent = make_agent(ScriptedModel(script=[]), now=lambda: 0.0)
    payload = {**position(["e2e4", "e7e5"], restrict=["g1f3"]), "clock": clock(white_ms=10_000)}
    out = await run(agent, payload, cfg)
    ply = out["plies"][-1]
    assert (ply["source"], ply["clock_ms"]) == ("forced", 15_000)


async def test_a_fraction_of_a_millisecond_left_is_in_time(make_agent, run, cfg, wall):
    agent = make_agent(ScriptedModel(script=[wall.think(0.9996)]), now=wall)
    out = await run(agent, {**human("e4"), "clock": clock(black_ms=1_000)}, cfg)
    assert out["outcome"] is None
    assert out["plies"][-1]["clock_ms"] == 5_001


async def test_a_noop_still_checks_the_clock_it_carries(make_agent, run, cfg):
    agent = make_agent(ScriptedModel(script=["MOVE: e5"]))
    await run(agent, {**human("e4"), "clock": clock()}, cfg)
    out = await run(agent, {"clock": clock()}, cfg)
    assert (out["error"], agent.get_state(cfg).values["invocation"]["action"]) == (None, "noop")
    other = clock(control={"base_ms": 1, "increment_ms": 0})
    out = await run(agent, {"clock": other}, cfg)
    assert out["error"] == "the time control is fixed for the game"


@pytest.mark.parametrize(
    ("payload", "error"),
    [
        ({"clock": clock(), "flag": "white"}, "this game has no clock"),
        ({**human("e4"), "flag": "white"}, "send a flag with the clock alone"),
    ],
)
async def test_flags_on_an_untimed_game_are_rejected(make_agent, run, cfg, payload, error):
    agent = make_agent(ScriptedModel(script=["MOVE: e5"]))
    await run(agent, human("d4"), cfg)
    out = await run(agent, payload, cfg)
    assert out["error"] == error
    assert out["outcome"] is None


@pytest.mark.parametrize(
    ("payload", "error"),
    [
        ({"flag": "white"}, "this game is timed: send the clock with every run"),
        ({"clock": clock(black_ms=0), "flag": "black"}, "black is not to move"),
        ({"clock": clock(white_ms=0), "flag": "grey"}, "grey is not to move"),
        ({"clock": clock(white_ms=1), "flag": "white"}, "white still has time"),
        (
            {
                "clock": clock(white_ms=0, control={"base_ms": 1, "increment_ms": 0}),
                "flag": "white",
            },
            "the time control is fixed for the game",
        ),
    ],
)
async def test_bad_flags_are_rejected(make_agent, run, cfg, payload, error):
    agent = make_agent(ScriptedModel(script=["MOVE: e5"]))
    await run(agent, {**human("e4"), "clock": clock()}, cfg)
    out = await run(agent, payload, cfg)
    assert out["error"] == error
    assert out["outcome"] is None


async def test_no_flag_once_the_game_is_over(make_agent, run, cfg):
    agent = make_agent(ScriptedModel(script=["MOVE: e5"]))
    await run(agent, {**human("e4"), "clock": clock()}, cfg)
    await run(agent, {"clock": clock(white_ms=0), "flag": "white"}, cfg)
    out = await run(agent, {"clock": clock(white_ms=0), "flag": "white"}, cfg)
    assert out["error"] == "the game is over"


@pytest.mark.parametrize(
    ("second", "error"),
    [
        (human("d4"), "this game is timed: send the clock with every run"),
        (
            {**human("d4"), "clock": clock(control={"base_ms": 1, "increment_ms": 0})},
            "the time control is fixed for the game",
        ),
        ({**human("d4"), "clock": clock(white_ms=0)}, "a clock has run out: send a flag"),
        (
            {**human("d4"), "clock": {**clock(), "white_ms": 1.5}},
            "the clock needs whole milliseconds, a positive base and a non-negative increment",
        ),
    ],
)
async def test_a_timed_game_checks_every_runs_clock(make_agent, run, cfg, second, error):
    agent = make_agent(ScriptedModel(script=["MOVE: e5"]))
    await run(agent, {**human("e4"), "clock": clock()}, cfg)
    out = await run(agent, second, cfg)
    assert out["error"] == error
    assert out["moves"] == ["e2e4", "e7e5"]


async def test_a_retry_needs_the_clock_too(make_agent, run, cfg):
    agent = make_agent(ScriptedModel(script=[RuntimeError("provider down")]))
    with pytest.raises(RuntimeError):
        await run(agent, {**human("e4"), "clock": clock()}, cfg)
    out = await run(agent, {}, cfg)
    assert out["error"] == "this game is timed: send the clock with every run"


async def test_a_clock_starts_only_with_the_game(make_agent, run, cfg):
    agent = make_agent(ScriptedModel(script=["MOVE: e5"]))
    await run(agent, human("e4"), cfg)
    out = await run(agent, {**human("d4"), "clock": clock()}, cfg)
    assert out["error"] == "this game is untimed: a clock is set when the game starts"


@pytest.mark.parametrize(
    "bad",
    [
        None,
        {"control": None, "white_ms": 1, "black_ms": 1},
        clock(control={"base_ms": 0, "increment_ms": 0}),
        clock(control={"base_ms": 1, "increment_ms": -1}),
        clock(white_ms=True),
    ],
)
async def test_malformed_clocks_are_rejected(make_agent, run, cfg, bad):
    agent = make_agent(ScriptedModel(script=[]))
    out = await run(agent, {**human("e4"), "clock": bad if bad is not None else 5}, cfg)
    assert out["error"].startswith("the clock needs whole milliseconds")
    assert not [m for m in out["messages"] if isinstance(m, AIMessage)]
