import chess
import pytest
from langchain_core.messages import AIMessage, HumanMessage

from langchain_chess import create_chess_agent
from langchain_chess.testing import ScriptedModel, human, position

SHUFFLE = ["g1f3", "g8f6", "f3g1", "f6g8"]
BLACK_TO_MOVE = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"


def ais(result):
    return [m for m in result["messages"] if isinstance(m, AIMessage)]


async def test_first_run_writes_the_empty_record(make_agent, run, cfg):
    agent = make_agent(ScriptedModel(script=[]))
    out = await run(agent, {}, cfg)
    assert out["outcome"] is None
    assert (out["moves"], out["plies"], out["turns"]) == ([], [], [])
    assert out["start_fen"] == chess.STARTING_FEN


async def test_position_command_plays_and_records(make_agent, run, cfg):
    model = ScriptedModel(script=["Central. MOVE: e4"])
    out = await run(make_agent(model), position(), cfg)
    assert out["moves"] == ["e2e4"]
    ply = out["plies"][0]
    assert ply["san"] == "e4"
    assert ply["source"] == "llm"
    assert ply["analysis"] == "Central. MOVE: e4"
    assert ply["model"] == "anthropic:claude-opus-5"
    assert ply["message_id"] == ais(out)[0].id
    turn = out["turns"][0]
    assert turn["status"] == "committed"
    assert turn["ply"] == 0
    assert ply["turn_id"] == turn["id"]
    assert [c["kind"] for c in turn["calls"]] == ["llm"]
    assert turn["latency_ms"] > 0
    assert "position" not in out
    assert out["messages"][0].content == "New game. You are White."


async def test_same_chat_message_twice_is_a_noop(make_agent, run, cfg):
    model = ScriptedModel(script=["MOVE: e5"])
    agent = make_agent(model)
    await run(agent, human("e4", id="m1"), cfg)
    out = await run(agent, human("e4", id="m1"), cfg)
    assert out["moves"] == ["e2e4", "e7e5"]
    assert model.calls == 1
    assert len(ais(out)) == 1
    assert len(out["turns"]) == 1


@pytest.mark.parametrize("empty", [{}, {"messages": []}, None])
async def test_empty_submit_after_a_commit_is_a_noop(make_agent, run, cfg, empty):
    model = ScriptedModel(script=["MOVE: e4"])
    agent = make_agent(model)
    await run(agent, position(), cfg)
    out = await run(agent, empty, cfg)
    assert out["moves"] == ["e2e4"]
    assert model.calls == 1
    # `None` resumes the finished checkpoint, so nothing runs at all.
    expected = "execute" if empty is None else "noop"
    assert agent.get_state(cfg).values["invocation"]["action"] == expected


async def test_same_root_with_a_new_restriction_is_rejected_as_diverged(make_agent, run, cfg):
    agent = make_agent(ScriptedModel(script=["MOVE: e4"]))
    await run(agent, position(), cfg)
    out = await run(agent, position(restrict=["d2d4"]), cfg)
    assert out["error"] == "the position does not extend this game; use a new thread"
    assert out["moves"] == ["e2e4"]
    assert agent.get_state(cfg).values["invocation"]["action"] == "reject"


async def test_resent_position_retries_a_failed_turn(make_agent, run, cfg):
    model = ScriptedModel(script=[RuntimeError("provider down"), "MOVE: d4"])
    agent = make_agent(model)
    with pytest.raises(RuntimeError, match="provider down"):
        await run(agent, position(), cfg)
    assert agent.get_state(cfg).values["turns"][-1]["status"] == "pending"
    out = await run(agent, position(), cfg)
    assert out["moves"] == ["d2d4"]
    assert len(out["turns"]) == 1
    assert out["turns"][0]["status"] == "committed"


async def test_fresh_go_while_a_turn_is_pending_is_rejected(make_agent, run, cfg):
    model = ScriptedModel(script=[RuntimeError("boom"), "MOVE: e4"])
    agent = make_agent(model)
    with pytest.raises(RuntimeError):
        await run(agent, human("go"), cfg)
    out = await run(agent, human("go", id="go2"), cfg)
    assert out["error"] == "finish or retry the pending turn first"
    assert "go2" not in [m.id for m in out["messages"]]
    assert out["turns"][-1]["status"] == "pending"
    assert out["moves"] == []
    out = await run(agent, {}, cfg)
    assert out["moves"] == ["e2e4"]
    assert out["turns"][-1]["status"] == "committed"
    assert out["error"] is None


async def test_position_and_message_together_are_rejected(make_agent, run, cfg):
    out = await run(make_agent(ScriptedModel(script=[])), {**position(), **human("e4")}, cfg)
    assert out["error"] == "send a position or a message, not both"
    assert out["messages"] == []


async def test_new_position_abandons_a_pending_turn(make_agent, run, cfg):
    model = ScriptedModel(script=[RuntimeError("cancelled"), "MOVE: Nf3"])
    agent = make_agent(model)
    with pytest.raises(RuntimeError):
        await run(agent, position(), cfg)
    out = await run(agent, position(["e2e4", "e7e5"]), cfg)
    assert [t["status"] for t in out["turns"]] == ["abandoned", "committed"]
    assert [p["source"] for p in out["plies"]] == ["external", "external", "llm"]
    assert out["messages"][-2].content == "New game. You are White."


async def test_illegal_replies_then_a_legal_one(make_agent, run, cfg):
    model = ScriptedModel(script=["MOVE: Qh5", "no move here", "MOVE: e4"])
    out = await run(make_agent(model), position(), cfg)
    assert out["moves"] == ["e2e4"]
    turn = out["turns"][0]
    assert turn["illegal_attempts"] == 2
    kinds = [(type(m).__name__, m.id in turn["rejected_message_ids"]) for m in out["messages"]]
    assert kinds == [
        ("HumanMessage", False),
        ("AIMessage", True),
        ("HumanMessage", False),
        ("AIMessage", True),
        ("HumanMessage", False),
        ("AIMessage", False),
    ]
    assert [m.id for m in out["messages"] if m.id in turn["feedback_message_ids"]] == [
        out["messages"][2].id,
        out["messages"][4].id,
    ]
    assert "`Qh5` is not a legal move" in out["messages"][2].content
    # The third request shows only the latest failed attempt, then all feedback, then the board.
    third = [m.content for m in model.requests[2]]
    assert "MOVE: Qh5" not in third
    assert "no move here" in third
    assert sum("Try again" in str(c) for c in third) == 2
    assert str(third[-1]).startswith("Moves so far:")
    assert len(turn["calls"]) == 3


async def test_exhausted_retries_resign(make_agent, run, cfg):
    model = ScriptedModel(script=["MOVE: Qh5"] * 4)
    out = await run(make_agent(model), position(), cfg)
    assert out["outcome"] == {"kind": "resignation", "winner": "black", "reason": "illegal_moves"}
    turn = out["turns"][0]
    assert turn["status"] == "terminal"
    assert turn["ply"] is None
    assert len(turn["calls"]) == 4
    assert turn["illegal_attempts"] == 4
    results = [m for m in ais(out) if "resigns" in m.content]
    assert [m.content for m in results] == ["White resigns after repeated illegal moves. 0-1"]


async def test_after_a_resignation(make_agent, run, cfg):
    agent = make_agent(ScriptedModel(script=["MOVE: Qh5"] * 4), max_retries=3)
    await run(agent, human("go", id="g1"), cfg)
    before = len(agent.get_state(cfg).values["messages"])
    out = await run(agent, {}, cfg)
    assert agent.get_state(cfg).values["invocation"]["action"] == "noop"
    out = await run(agent, human("go", id="g1"), cfg)
    assert agent.get_state(cfg).values["invocation"]["action"] == "noop"
    assert len(out["messages"]) == before
    out = await run(agent, human("e4"), cfg)
    assert out["error"] == "the game is over"
    assert len(out["messages"]) == before
    out = await run(agent, position(), cfg)
    assert out["error"] == "the game is over"


async def test_empty_restrict_is_rejected(make_agent, run, cfg):
    out = await run(make_agent(ScriptedModel(script=[])), position(restrict=[]), cfg)
    assert out["error"] == "restrict must not be empty"


async def test_restrict_must_be_legal(make_agent, run, cfg):
    out = await run(make_agent(ScriptedModel(script=[])), position(restrict=["e2e5"]), cfg)
    assert out["error"] == "restrict contains moves that are not legal here"


async def test_restrict_narrows_the_turn(make_agent, run, cfg):
    model = ScriptedModel(script=["MOVE: e4", "MOVE: d4"])
    out = await run(make_agent(model), position(restrict=["d2d4", "g1f3"]), cfg)
    assert out["moves"] == ["d2d4"]
    assert out["turns"][0]["initial_allowed"] == ["g1f3", "d2d4"]
    assert "Only these moves are permitted: Nf3, d4." in model.requests[0][-1].content
    assert "`e4` is not an allowed move here" in out["messages"][2].content


@pytest.mark.parametrize(("claims", "reason"), [("never", "fivefold"), ("auto", "threefold")])
async def test_moves_after_an_ending_are_rejected(make_agent, run, cfg, claims, reason):
    agent = make_agent(ScriptedModel(script=[]), draw_claims=claims)
    out = await run(agent, position([*SHUFFLE * 4, "e2e4"]), cfg)
    assert "comes after the game ended" in out["error"]
    assert reason in out["error"]
    assert out["moves"] == []


async def test_threefold_is_not_adjudicated_before_the_agent_moves(make_agent, run, cfg):
    model = ScriptedModel(script=["MOVE: Ng8"])
    agent = make_agent(model, draw_claims="auto")
    out = await run(agent, position([*SHUFFLE, *SHUFFLE[:3]]), cfg)
    assert model.calls == 1
    assert out["moves"][-1] == "f6g8"
    assert out["outcome"] == {"kind": "draw", "reason": "threefold"}
    assert out["turns"][-1]["status"] == "committed"
    assert ais(out)[-1].content == "Draw by threefold. 1/2-1/2"


@pytest.mark.parametrize("text", ["--", "Z0", "0000", "@@@@"])
async def test_null_move_chat_inputs_are_rejected(make_agent, run, cfg, text):
    out = await run(make_agent(ScriptedModel(script=[])), human(text, id="bad"), cfg)
    assert "neither `go` nor a legal move" in out["error"]
    assert out["messages"] == []


@pytest.mark.parametrize(
    ("command", "outcome"),
    [
        (
            position(start_fen="8/8/8/4k3/8/8/8/4K3 w - - 0 1"),
            {"kind": "draw", "reason": "insufficient_material"},
        ),
        (position(["f2f3", "e7e5", "g2g4", "d8h4"]), {"kind": "checkmate", "winner": "black"}),
    ],
)
async def test_terminal_positions(make_agent, run, cfg, command, outcome):
    model = ScriptedModel(script=[])
    out = await run(make_agent(model), command, cfg)
    assert out["outcome"] == outcome
    assert [t["status"] for t in out["turns"]] == ["terminal"]
    assert len(ais(out)) == 1
    assert model.calls == 0


async def test_chat_move_that_mates_ends_the_game(make_agent, run, cfg):
    model = ScriptedModel(script=["MOVE: f3", "MOVE: g4"])
    agent = make_agent(model)
    await run(agent, human("go"), cfg)
    await run(agent, human("e5"), cfg)
    out = await run(agent, human("Qh4#"), cfg)
    assert out["outcome"] == {"kind": "checkmate", "winner": "black"}
    assert out["plies"][-1]["source"] == "external"
    assert out["turns"][-1]["status"] == "terminal"
    assert ais(out)[-1].content == "Checkmate, black wins. 0-1"
    assert model.calls == 2


async def test_black_to_move_root(make_agent, run, cfg):
    model = ScriptedModel(script=["MOVE: c5", "MOVE: d6"])
    agent = make_agent(model)
    out = await run(agent, position(start_fen=BLACK_TO_MOVE), cfg)
    assert out["messages"][0].content == "New game. You are Black."
    assert str(model.requests[0][-1].content).startswith("Moves so far: (none")
    out = await run(agent, position(["c7c5", "g1f3"], start_fen=BLACK_TO_MOVE), cfg)
    assert out["messages"][-2].content == "2. Nf3"
    assert str(model.requests[1][-1].content).startswith("Moves so far: 1... c5 2. Nf3\n")


async def test_a_different_root_is_rejected(make_agent, run, cfg):
    agent = make_agent(ScriptedModel(script=["MOVE: c5"]))
    await run(agent, position(start_fen=BLACK_TO_MOVE), cfg)
    out = await run(agent, position(), cfg)
    assert out["error"] == "a different starting position; use a new thread"


async def test_the_same_position_again_gives_a_new_turn(make_agent, run, cfg):
    model = ScriptedModel(script=["MOVE: e4", "MOVE: e5"])
    agent = make_agent(model)
    await run(agent, position(), cfg)
    out = await run(agent, position(["e2e4"]), cfg)
    assert out["moves"] == ["e2e4", "e7e5"]
    out = await run(agent, position(["e2e4", "e7e5"], restrict=["g1f3"]), cfg)
    assert out["messages"][-2].content == "Your move as White."
    assert out["plies"][-1]["source"] == "forced"


async def test_invalid_fen_is_rejected(make_agent, run, cfg):
    out = await run(make_agent(ScriptedModel(script=[])), position(start_fen="nope"), cfg)
    assert out["error"].startswith("invalid FEN")


async def test_schemas(make_agent, run, cfg):
    agent = make_agent(ScriptedModel(script=["MOVE: e4"]))
    assert set(agent.get_input_jsonschema()["properties"]) == {"messages", "position"}
    output = set(agent.get_output_jsonschema()["properties"])
    assert {"moves", "plies", "turns", "outcome", "start_fen", "error"} <= output
    assert not output & {"position", "allowed_moves", "proposal", "invocation", "candidates"}
    out = await run(agent, {**position(), "moves": ["d2d4"], "outcome": "x"}, cfg)
    assert out["moves"] == ["e2e4"]
    assert agent.get_state(cfg).values["position"] is None


async def test_stateless_agent(run):
    model = ScriptedModel(script=["MOVE: e5"])
    agent = create_chess_agent(model)
    out = await run(agent, position(["e2e4"]), {})
    assert out["moves"] == ["e2e4", "e7e5"]
    out = await run(agent, {}, {})
    assert out["moves"] == []
    assert model.calls == 1


async def test_a_call_without_usage_has_no_cost(make_agent, run, cfg):
    model = ScriptedModel(script=["MOVE: e4"], usage_metadata={})
    out = await run(make_agent(model), position(), cfg)
    call = out["turns"][0]["calls"][0]
    assert call["input_tokens"] is None
    assert call["cost_usd"] is None


async def test_an_empty_reply_is_stored_as_a_placeholder(make_agent, run, cfg):
    model = ScriptedModel(script=["", "MOVE: e4"])
    out = await run(make_agent(model), position(), cfg)
    placeholder = out["messages"][1]
    assert placeholder.content == "[no text in reply]"
    assert placeholder.usage_metadata["output_tokens"] == 10
    assert "output budget was probably spent on reasoning" in out["messages"][2].content
    assert out["moves"] == ["e2e4"]


async def test_prompt_too_long_is_a_context_budget_error(make_agent, run, cfg):
    from langchain_chess import ContextBudgetError

    model = ScriptedModel(script=[ValueError("400: prompt is too long: 1200000 tokens")])
    agent = make_agent(model)
    with pytest.raises(ContextBudgetError, match="prompt is too long"):
        await run(agent, position(), cfg)
    assert agent.get_state(cfg).values["turns"][-1]["status"] == "pending"


async def test_chat_game_with_memory_none_sees_only_the_current_turn(make_agent, run, cfg):
    model = ScriptedModel(script=["MOVE: e5", "MOVE: Nc6"])
    agent = make_agent(model)
    await run(agent, human("e4"), cfg)
    out = await run(agent, human("Nf3"), cfg)
    assert out["moves"] == ["e2e4", "e7e5", "g1f3", "b8c6"]
    second = model.requests[1]
    assert [m.content for m in second[1:-1]] == ["Nf3"]
    assert isinstance(second[-1], HumanMessage)


async def test_summarize_memory_drops_earlier_rejected_attempts(make_agent, run, cfg):
    model = ScriptedModel(
        script=["MOVE: Qh5", "MOVE: e5", "MOVE: Nc6"], profile={"max_input_tokens": 100_000}
    )
    agent = make_agent(model, memory="summarize")
    await run(agent, human("e4"), cfg)
    await run(agent, human("Nf3"), cfg)
    seen = [m.content for m in model.requests[2][1:-1]]
    assert seen == ["e4", "MOVE: e5", "Nf3"]


async def test_the_move_list_follows_the_position_block(make_agent, run, cfg):
    model = ScriptedModel(script=["MOVE: e4"])
    await run(make_agent(model, show_legal_moves=False), position(), cfg)
    assert "Legal moves" not in model.requests[0][-1].content
    assert str(model.requests[0][0].content).startswith("You are a strong chess player.")
