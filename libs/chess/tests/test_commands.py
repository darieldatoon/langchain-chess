"""Resigning and offering a draw: chat commands that open no model turn."""

from typing import Any

import chess
import pytest
from langchain.agents.middleware.types import AgentMiddleware
from langchain_core.messages import AIMessage, HumanMessage

from langchain_chess import create_chess_agent
from langchain_chess.grading import positions
from langchain_chess.middleware.core import ChessCore
from langchain_chess.prompt import position_renderer
from langchain_chess.recorder import CallRecorder
from langchain_chess.state import RECORD_KEYS
from langchain_chess.testing import ScriptedModel, human, position

MATE = ["f2f3", "e7e5", "g2g4", "d8h4"]


def ais(result: dict[str, Any]) -> list[AIMessage]:
    return [m for m in result["messages"] if isinstance(m, AIMessage)]


def state(agent: Any, cfg: dict[str, Any]) -> dict[str, Any]:
    return agent.get_state(cfg).values


class RaiseOnce(AgentMiddleware):
    """Fails the first run in `after_agent`, after the turn saved its decision."""

    def __init__(self) -> None:
        self.raised = False

    def after_agent(self, state, runtime):
        if not self.raised:
            self.raised = True
            msg = "after_agent failed"
            raise RuntimeError(msg)

    async def aafter_agent(self, state, runtime):
        self.after_agent(state, runtime)


@pytest.mark.parametrize(("text", "winner"), [("resign white", "black"), ("RESIGN BLACK", "white")])
async def test_either_side_resigns_on_either_side_s_move(make_agent, run, cfg, text, winner):
    model = ScriptedModel(script=["MOVE: e5"])
    agent = make_agent(model)
    await run(agent, human("e4", id="m1"), cfg)
    out = await run(agent, human(text, id="r1"), cfg)
    assert out["outcome"] == {"kind": "resignation", "winner": winner, "reason": "resigned"}
    assert out["moves"] == ["e2e4", "e7e5"]
    assert len(out["plies"]) == 2
    resigned = out["turns"][-1]
    assert resigned["status"] == "terminal"
    assert resigned["ply"] is None
    assert resigned["calls"] == []
    assert resigned["request"] == resigned["opened_message_id"] == "r1"
    assert resigned["initial_allowed"] == []
    loser = "White" if winner == "black" else "Black"
    score = "0-1" if winner == "black" else "1-0"
    assert ais(out)[-1].content == f"{loser} resigned · {winner.capitalize()} wins. {score}"
    assert "r1" in state(agent, cfg)["consumed_message_ids"]
    assert state(agent, cfg)["invocation"] == {
        "id": state(agent, cfg)["invocation"]["id"],
        "action": "noop",
        "opened_turn": resigned["id"],
    }
    assert model.calls == 1


BLACK_TO_MOVE = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"


@pytest.mark.parametrize(("text", "winner"), [("resign white", "black"), ("resign black", "white")])
async def test_either_side_resigns_on_black_s_move_too(make_agent, run, cfg, text, winner):
    agent = make_agent(ScriptedModel(script=[RuntimeError("provider down")]))
    with pytest.raises(RuntimeError, match="provider down"):
        await run(agent, position(start_fen=BLACK_TO_MOVE), cfg)
    out = await run(agent, human(text, id="r1"), cfg)
    assert out["outcome"] == {"kind": "resignation", "winner": winner, "reason": "resigned"}
    assert out["start_fen"] == BLACK_TO_MOVE


async def test_resigning_abandons_a_pending_turn_without_playing_its_saved_move(
    make_agent, run, cfg
):
    agent = make_agent(ScriptedModel(script=["MOVE: e5"]), middleware=[RaiseOnce()])
    with pytest.raises(RuntimeError, match="after_agent failed"):
        await run(agent, human("e4", id="m1"), cfg)
    assert state(agent, cfg)["proposal"]["uci"] == "e7e5"
    out = await run(agent, human("resign white", id="r1"), cfg)
    assert [t["status"] for t in out["turns"]] == ["abandoned", "terminal"]
    assert out["moves"] == ["e2e4"]
    assert out["turns"][0]["ply"] is None
    assert state(agent, cfg)["proposal"] is None
    assert state(agent, cfg)["allowed_moves"] == []
    assert out["outcome"]["reason"] == "resigned"


async def test_resigning_discards_a_saved_forfeit(make_agent, run, cfg):
    agent = make_agent(ScriptedModel(script=["MOVE: Qh5"] * 4), middleware=[RaiseOnce()])
    with pytest.raises(RuntimeError, match="after_agent failed"):
        await run(agent, position(), cfg)
    assert state(agent, cfg)["terminal_intent"]["reason"] == "illegal_moves"
    out = await run(agent, human("resign black", id="r1"), cfg)
    assert out["outcome"] == {"kind": "resignation", "winner": "white", "reason": "resigned"}
    assert [t["status"] for t in out["turns"]] == ["abandoned", "terminal"]
    assert state(agent, cfg)["terminal_intent"] is None


async def test_a_resignation_after_the_game_is_rejected_and_a_resent_one_is_a_noop(
    make_agent, run, cfg
):
    agent = make_agent(ScriptedModel(script=[]))
    await run(agent, human("resign white", id="r1"), cfg)
    out = await run(agent, human("resign white", id="r1"), cfg)
    assert state(agent, cfg)["invocation"]["action"] == "noop"
    assert len(out["turns"]) == 1
    out = await run(agent, human("resign black", id="r2"), cfg)
    assert out["error"] == "the game is over"
    assert out["outcome"]["winner"] == "black"
    finished = create_chess_agent(ScriptedModel(script=[]), checkpointer=agent.checkpointer)
    mated = {"configurable": {"thread_id": cfg["configurable"]["thread_id"] + "-mate"}}
    await run(finished, position(MATE), mated)
    out = await run(finished, human("resign black", id="r3"), mated)
    assert out["error"] == "the game is over"
    assert out["outcome"]["kind"] == "checkmate"


async def test_a_declined_draw_changes_nothing_but_the_offers(make_agent, run, cfg):
    model = ScriptedModel(script=["MOVE: e5"])
    agent = make_agent(model)
    await run(agent, human("e4", id="m1"), cfg)
    before = state(agent, cfg)
    out = await run(agent, human("draw white", id="d1"), cfg)
    assert out["draw_offers"] == [{"ply": 2, "by": "white", "answer": "declined"}]
    assert (out["moves"], out["plies"], out["turns"]) == (
        before["moves"],
        before["plies"],
        before["turns"],
    )
    assert out["outcome"] is None
    assert model.calls == 1
    assert len(ais(out)) == len(ais(before)) + 1
    assert ais(out)[-1].content == "Draw declined."
    assert state(agent, cfg)["invocation"]["action"] == "noop"
    assert "d1" in state(agent, cfg)["consumed_message_ids"]
    # The game carries on.
    later = make_agent(ScriptedModel(script=["MOVE: Nc6"]), checkpointer=agent.checkpointer)
    out = await run(later, human("Nf3", id="m2"), cfg)
    assert out["moves"] == ["e2e4", "e7e5", "g1f3", "b8c6"]


@pytest.mark.parametrize(
    ("setup", "text", "error"),
    [
        ([], "draw black", "offer a draw on your own move"),
        (["draw white"], "draw white", "you already offered a draw in this position"),
    ],
)
async def test_draw_offers_that_are_rejected(make_agent, run, cfg, setup, text, error):
    agent = make_agent(ScriptedModel(script=[]))
    for i, command in enumerate(setup):
        await run(agent, human(command, id=f"s{i}"), cfg)
    out = await run(agent, human(text, id="d9"), cfg)
    assert out["error"] == error
    assert len(out["draw_offers"]) == len(setup)
    assert state(agent, cfg)["invocation"]["action"] == "reject"


async def test_a_draw_offer_while_a_turn_is_pending_is_rejected(make_agent, run, cfg):
    agent = make_agent(ScriptedModel(script=[RuntimeError("provider down")]))
    with pytest.raises(RuntimeError, match="provider down"):
        await run(agent, human("e4", id="m1"), cfg)
    out = await run(agent, human("draw white", id="d1"), cfg)
    assert out["error"] == "finish or retry the pending turn first"
    assert out["draw_offers"] == []
    assert out["turns"][-1]["status"] == "pending"


async def test_a_rejected_command_is_cleared_by_a_draw_offer_and_a_resignation(
    make_agent, run, cfg
):
    agent = make_agent(ScriptedModel(script=[]))
    out = await run(agent, human("e5", id="bad"), cfg)
    assert out["error"] is not None
    out = await run(agent, human("draw white", id="d1"), cfg)
    assert out["error"] is None
    await run(agent, human("resign green", id="bad2"), cfg)
    assert (
        state(agent, cfg)["error"]
        == "`resign green`: name the side, `resign white` or `resign black`"
    )
    out = await run(agent, human("resign white", id="r1"), cfg)
    assert out["error"] is None


@pytest.mark.parametrize("text", ["draw white", "resign black"])
async def test_a_control_command_can_be_a_thread_s_first(make_agent, run, cfg, text):
    out = await run(make_agent(ScriptedModel(script=[])), human(text, id="c1"), cfg)
    assert out["moves"] == []
    assert out["start_fen"].startswith("rnbqkbnr")
    assert out["error"] is None
    assert len(out["draw_offers"]) == (1 if text.startswith("draw") else 0)


async def test_a_record_from_before_draw_offers_reads_as_none(make_agent, run, cfg):
    agent = make_agent(ScriptedModel(script=["MOVE: e5"]))
    await run(agent, human("e4", id="m1"), cfg)
    agent.update_state(cfg, {"draw_offers": None})
    out = await run(agent, human("draw white", id="d1"), cfg)
    assert out["draw_offers"] == [{"ply": 2, "by": "white", "answer": "declined"}]


def test_a_record_without_the_draw_offers_key_reads_as_none():
    core = ChessCore(
        memory=False,
        max_retries=3,
        draw_claims="auto",
        render=position_renderer(show_fen=True, show_board=False, move_list="both"),
        recorder=CallRecorder(),
    )
    old = {
        "start_fen": chess.STARTING_FEN,
        "moves": [],
        "plies": [],
        "turns": [],
        "outcome": None,
        "consumed_message_ids": [],
        "messages": [HumanMessage("draw white", id="d1")],
    }
    update = core._lifecycle(old)
    assert update["draw_offers"] == [{"ply": 0, "by": "white", "answer": "declined"}]


async def test_draw_offers_are_part_of_the_record(make_agent, run, cfg):
    agent = make_agent(ScriptedModel(script=[]))
    assert set(agent.get_output_jsonschema()["properties"]) >= RECORD_KEYS
    assert "draw_offers" not in agent.get_input_jsonschema()["properties"]
    out = await run(agent, {}, cfg)
    assert out["draw_offers"] == []


def test_a_resigned_game_is_scored_by_the_engine():
    game = positions(
        "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        ["e2e4"],
        {"kind": "resignation", "winner": "white", "reason": "resigned"},
    )
    assert game[-1].settled is None


async def test_a_first_position_replayed_after_the_game_ended_is_rejected(make_agent, run, cfg):
    # A lost response to a new game's first packet, resent after the game was already over.
    agent = make_agent(ScriptedModel(script=[]))
    await run(agent, position(MATE), cfg)
    out = await run(agent, position(MATE), cfg)
    assert out["error"] == "the game is over"
    assert out["outcome"]["kind"] == "checkmate"
