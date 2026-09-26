import asyncio

import chess
from textual.widgets import Input, Static
from textual.worker import WorkerState

from langchain_chess import create_chess_agent
from langchain_chess.testing import ScriptedModel
from langchain_chess_cli.options import AgentOptions
from langchain_chess_cli.tui.app import ChessApp


def app_with(script, *, side="white", delay=0.0, options=None):
    model = ScriptedModel(script=list(script), delay=delay)
    factory = lambda saver: create_chess_agent(model, checkpointer=saver)  # noqa: E731
    return ChessApp(factory, options or AgentOptions(), side=side), model


def text(app, widget_id):
    return str(app.query_one(f"#{widget_id}", Static).render())


async def settle(app, pilot):
    await app.workers.wait_for_complete()
    await pilot.pause()


async def play(pilot, move):
    pilot.app.query_one("#move", Input).focus()
    await pilot.pause()
    for key in move:
        await pilot.press(key)
    await pilot.press("enter")


async def test_a_failed_first_turn_as_black_retries_and_commits_once():
    app, model = app_with([RuntimeError("provider down"), "Solid.\nMOVE: e4"], side="black")
    async with app.run_test() as pilot:
        await settle(app, pilot)
        assert "failed (provider down)" in text(app, "status")
        await play(pilot, "e5")  # blocked while the turn is pending
        await settle(app, pilot)
        assert model.calls == 1
        await pilot.press("ctrl+r")
        await settle(app, pilot)
        turns = app.values["turns"]
        assert [t["status"] for t in turns] == ["committed"]
        assert app.values["moves"] == ["e2e4"]
        assert model.calls == 2
        assert "Your move." in text(app, "status")
        assert "Solid." in text(app, "analysis")
        await pilot.press("ctrl+r")  # nothing pending: a no-op
        await settle(app, pilot)
        assert model.calls == 2


async def test_playing_white_and_the_move_list():
    app, _model = app_with(["MOVE: e5", "MOVE: Nc6"])
    async with app.run_test() as pilot:
        await pilot.press("ctrl+s")  # White doesn't start: a no-op
        await play(pilot, "e4")
        await settle(app, pilot)
        await play(pilot, "Nf3")
        await settle(app, pilot)
        moves = text(app, "moves")
        assert "1. e4 (you)  e5 (LLM $" in moves
        assert "2. Nf3 (you)  Nc6 (LLM" in moves
        assert "Nc6 by LLM (anthropic:claude-opus-5)" in text(app, "details")
        await play(pilot, "Qh8")
        await settle(app, pilot)
        assert "neither `go` nor a legal move" in text(app, "status")


async def test_input_is_blocked_on_the_agents_move_and_while_it_thinks():
    app, _model = app_with(["MOVE: e5"], delay=1.5)
    async with app.run_test() as pilot:
        await play(pilot, "e4")
        await pilot.pause(0.05)
        assert "thinking" in text(app, "status")
        await play(pilot, "d4")
        await settle(app, pilot)
        assert app.values["moves"] == ["e2e4", "e7e5"]
        assert app.query_one("#move", Input).value == ""
        app.query_one("#move", Input).focus()
        await pilot.pause()
        await pilot.press("enter")  # an empty line is ignored
        await settle(app, pilot)
        assert app.values["moves"] == ["e2e4", "e7e5"]


async def test_a_new_game_ignores_late_events_from_the_previous_one():
    app, _model = app_with(["MOVE: e5", "MOVE: d5"], delay=0.3)
    async with app.run_test() as pilot:
        await play(pilot, "e4")
        await pilot.pause(0.05)
        first = app.thread
        await pilot.press("ctrl+n")
        await settle(app, pilot)
        assert app.thread != first
        assert app.values == {}
        assert app.running is False
        assert "Your move." in text(app, "status")


async def test_switching_sides_starts_the_agent():
    app, model = app_with(["MOVE: e4"])
    async with app.run_test() as pilot:
        await pilot.press("ctrl+f")
        await settle(app, pilot)
        assert app.side == "black"
        assert app.values["moves"] == ["e2e4"]
        await pilot.press("ctrl+s")  # already started: a no-op
        await settle(app, pilot)
        assert model.calls == 1


async def test_the_game_over_blocks_input():
    app, model = app_with(["MOVE: f3", "MOVE: g4"], side="black")
    async with app.run_test() as pilot:
        await settle(app, pilot)
        await play(pilot, "e5")
        await settle(app, pilot)
        await play(pilot, "Qh4")
        await settle(app, pilot)
        assert "Checkmate, black wins. 0-1" in text(app, "status")
        await play(pilot, "a6")
        await settle(app, pilot)
        assert model.calls == 2


async def test_it_is_the_agents_move_after_a_side_switch_mid_game():
    app, model = app_with([])
    async with app.run_test() as pilot:
        app.side = "black"
        await play(pilot, "e4")
        await settle(app, pilot)
        assert model.calls == 0
        await asyncio.sleep(0)


async def test_a_late_failure_from_the_previous_game_is_ignored():
    app, _model = app_with([RuntimeError("late")], delay=0.3)
    async with app.run_test() as pilot:
        await play(pilot, "e4")
        await pilot.pause(0.05)
        await pilot.press("ctrl+n")
        await settle(app, pilot)
        assert app.failed is None
        assert "Your move." in text(app, "status")


async def test_moves_by_clicking_the_board():
    from langchain_chess_cli.tui.board import ChessBoard

    app, _model = app_with(["MOVE: e5"])
    async with app.run_test(size=(140, 45)) as pilot:
        board = app.query_one("#board", ChessBoard)
        for square in ("e2", "e4"):
            x, y = board.geometry.origin(chess.parse_square(square))
            await pilot.click("#board", offset=(x + 1, y + 1))
            await pilot.pause()
        await settle(app, pilot)
        assert app.values["moves"] == ["e2e4", "e7e5"]
        assert board.state.last_move == (chess.E7, chess.E5)
        assert board.state.interactive


async def test_typing_on_the_board_fills_the_input():
    app, _model = app_with(["MOVE: e5"])
    async with app.run_test() as pilot:
        await pilot.pause()
        for key in "e4":
            await pilot.press(key)
            await pilot.pause()
        assert app.query_one("#move", Input).value == "e4"
        await pilot.press("enter")
        await settle(app, pilot)
        assert app.values["moves"] == ["e2e4", "e7e5"]
        assert app.focused is app.query_one("#board")


async def test_model_and_error_text_is_shown_literally():
    app, _model = app_with([RuntimeError("bad [/] reply"), "Look [/] at [bold]this.\nMOVE: e5"])
    async with app.run_test() as pilot:
        await play(pilot, "e4")
        await settle(app, pilot)
        assert "failed (bad [/] reply)" in text(app, "status")
        await pilot.press("ctrl+r")
        await settle(app, pilot)
        assert "Look [/] at [bold]this." in text(app, "analysis")
        await play(pilot, "[/]")
        await settle(app, pilot)
        assert "legal move" in text(app, "status")


def saved_threads(app):
    return {c.config["configurable"]["thread_id"] for c in app.checkpointer.list(None)}


async def test_a_new_game_cancels_the_previous_run_and_drops_its_checkpoints():
    app, _model = app_with(["MOVE: e5"], delay=60)
    async with app.run_test() as pilot:
        await play(pilot, "e4")
        await pilot.pause(0.05)
        [run] = list(app.workers)
        assert saved_threads(app) == {app.thread}
        await pilot.press("ctrl+n")
        await settle(app, pilot)
        assert run.state == WorkerState.CANCELLED
        assert app.running is False
        assert saved_threads(app) == set()


async def test_a_finished_game_drops_its_checkpoints_on_a_new_game():
    app, _model = app_with(["MOVE: e5"])
    async with app.run_test() as pilot:
        await play(pilot, "e4")
        await settle(app, pilot)
        assert saved_threads(app) == {app.thread}
        await pilot.press("ctrl+n")
        await settle(app, pilot)
        assert saved_threads(app) == set()
