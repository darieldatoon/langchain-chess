import asyncio
import contextlib
import os
from types import SimpleNamespace

import chess
from langchain_core.messages import AIMessageChunk
from textual.widgets import Button, Input, Markdown, Static
from textual.worker import WorkerCancelled, WorkerState

from langchain_chess import create_chess_agent
from langchain_chess.testing import ScriptedModel
from langchain_chess_cli.tui.app import ChessApp, ConfirmResign, Game
from langchain_chess_cli.tui.board import ChessBoard
from langchain_chess_cli.tui.newgame import NewGameScreen
from langchain_chess_cli.tui.widgets import PlayerStrip, Stage
from langchain_chess_systemone.settings import ChessContext

LLM = ChessContext(policy="llm")


def app_with(script, *, side="white", delay=0.0, context=LLM, start=chess.STARTING_FEN, coin=0.3):
    model = ScriptedModel(script=list(script), delay=delay)
    built = []

    def factory(context, saver):
        built.append(context)
        return create_chess_agent(model, checkpointer=saver)

    app = ChessApp(factory, Game(context, side, start), limit=lambda m: 1000, coin=lambda: coin)
    app.built = built
    return app, model


def text(app, selector):
    return str(app.query_one(selector, Static).render())


def strip(app, which):
    widget = app.query_one(f"#{which}", PlayerStrip)
    return f"{text(widget, '.name')} | {text(widget, '.status')}"


def analysis(app):
    return app.query_one("#analysis", Markdown).source


async def settle(app, pilot):
    # A new game cancels the previous one's run; waiting on it raises.
    with contextlib.suppress(WorkerCancelled):
        await app.workers.wait_for_complete()
    await app.workers.wait_for_complete()
    await pilot.pause()


async def play(pilot, move):
    pilot.app.query_one("#move", Input).focus()
    await pilot.pause()
    for key in move:
        await pilot.press(key)
    await pilot.press("enter")


async def test_playing_white_fills_the_strips_moves_and_reply():
    app, _model = app_with(["The centre.\nMOVE: e5", "MOVE: Nc6"])
    async with app.run_test(size=(170, 48)) as pilot:
        assert strip(app, "bottom") == "○ You | Your turn"
        await pilot.press("ctrl+s")  # White doesn't start: a no-op
        await play(pilot, "e4")
        await settle(app, pilot)
        await play(pilot, "Nf3")
        await settle(app, pilot)
        assert strip(app, "top") == "● GLM-5.3 Flash | "
        assert strip(app, "bottom") == "○ You | Your turn"
        rows = text(app, "#move-rows").splitlines()
        assert rows[0].split() == ["1", "e4", "e5"]
        assert rows[1].split() == ["2", "Nf3", "Nc6"]
        assert text(app, "#opening") == "C44 · King's Knight Opening: Normal Variation"
        head = text(app, "#reply-head")
        assert "Move 2 · Black" in head
        assert "LLM chose  Nc6" in head
        assert "MOVE: Nc6" in analysis(app)
        assert "Game so far" in text(app, "#so-far")
        assert "2 moves" in text(app, "#so-far")
        await play(pilot, "Qh8")
        await settle(app, pilot)
        assert text(app, "#note") == "`Qh8` is neither `go` nor a legal move"
        # The server's own rejections show the same way.
        app.notice = None
        app.values = {**app.values, "error": "a different starting position"}
        app._refresh()
        assert text(app, "#note") == "Move rejected: a different starting position"


async def test_a_failed_first_turn_as_black_retries_and_commits_once():
    app, model = app_with([RuntimeError("provider down"), "Solid.\nMOVE: e4"], side="black")
    async with app.run_test(size=(170, 48)) as pilot:
        await settle(app, pilot)
        assert "Retry ^r" in [str(b.label) for b in app.query_one("#top").query(Button)]
        assert "Stopped" in text(app, "#reply-head")
        assert "provider down" in text(app, "#llm-notes")
        await play(pilot, "e5")  # blocked while the turn is pending
        await settle(app, pilot)
        assert model.calls == 1
        await pilot.click("#top Button")
        await settle(app, pilot)
        assert [t["status"] for t in app.values["turns"]] == ["committed"]
        assert app.values["moves"] == ["e2e4"]
        assert model.calls == 2
        assert "Solid." in analysis(app)
        await pilot.press("ctrl+r")  # nothing pending: a no-op
        await settle(app, pilot)
        assert model.calls == 2


async def test_thinking_counts_the_seconds_and_analysis_streams(monkeypatch):
    release = asyncio.Event()

    class Streaming:
        async def astream(self, payload, config, stream_mode):
            yield "messages", (AIMessageChunk(content="Thinking"), {"langgraph_node": "model"})
            yield "messages", (AIMessageChunk(content=" hard"), {"langgraph_node": "model"})
            yield "messages", (AIMessageChunk(content="tool"), {"langgraph_node": "tools"})
            await release.wait()

        async def aget_state(self, config):
            return SimpleNamespace(values={})

    app = ChessApp(lambda context, saver: Streaming(), Game(LLM, "black"), limit=lambda m: None)
    async with app.run_test(size=(170, 48)) as pilot:
        await pilot.pause()
        assert app.running
        assert app.analysis == "Thinking hard"
        # No turn yet: a stand-in shows the run, as the web's does.
        assert "Move 1 · White" in text(app, "#reply-head")
        assert "Thinking…" in text(app, "#reply-head")
        assert "Thinking hard" in analysis(app)
        assert text(app, "#top .status").startswith("Thinking… ")
        later = app.since + 65
        monkeypatch.setattr("langchain_chess_cli.tui.widgets.monotonic", lambda: later)
        for _ in range(50):  # the clock ticks once a second
            if text(app, "#top .status") == "Thinking… 65s":
                break
            await pilot.pause(0.1)
        assert text(app, "#top .status") == "Thinking… 65s"
        release.set()
        await settle(app, pilot)
        assert text(app, "#top .status") == ""


async def test_input_is_blocked_on_the_agents_move_and_while_it_thinks():
    app, _model = app_with(["MOVE: e5"], delay=60)
    async with app.run_test(size=(170, 48)) as pilot:
        await play(pilot, "e4")
        await pilot.pause(0.05)
        assert app.running
        await play(pilot, "d4")
        app.query_one("#move", Input).focus()
        await pilot.pause()
        await pilot.press("enter")  # an empty line is ignored
        await pilot.pause()
        assert app.query_one("#move", Input).value == ""
        assert len([w for w in app.workers if w.group == "agent-run"]) == 1
        app._start_game(app.game)  # cancels the run
        await settle(app, pilot)


async def test_the_agents_move_after_the_side_changes_mid_game():
    app, model = app_with([])
    async with app.run_test(size=(170, 48)) as pilot:
        app.game = Game(LLM, "black")
        await play(pilot, "e4")
        await settle(app, pilot)
        assert model.calls == 0


async def test_stepping_through_the_game():
    app, _model = app_with(["MOVE: e5", "MOVE: Nc6"])
    async with app.run_test(size=(170, 48)) as pilot:
        for move in ("e4", "Nf3"):
            await play(pilot, move)
            await settle(app, pilot)
        board = app.query_one("#board", ChessBoard)
        board.focus()
        await pilot.press("comma", "comma")
        assert app._index() == 2
        assert board.state.board.board_fen() == "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR"
        assert board.state.last_move == (chess.E7, chess.E5)
        assert not board.state.interactive
        assert app.query_one("#viewing").display
        assert text(app, "#viewing Static") == "Viewing move 2"
        assert app.query_one("#reply").border_title == "Reply before move 3"
        assert "e5" in text(app, "#reply-head")
        assert strip(app, "bottom") == "○ You | "
        await pilot.press("home")
        assert app._index() == 0
        assert "No reply yet." in text(app, "#reply-head")
        await pilot.press("full_stop")
        assert app._index() == 1
        await pilot.press("end")
        assert app._live()
        assert board.state.interactive
        await pilot.press("comma")
        await pilot.click("#viewing Button")
        assert app._live()
        app.action_go(1)
        app.action_go(99)
        assert app._live()


async def test_the_move_list_steps_with_the_keys_and_follows_new_moves():
    app, _model = app_with(["MOVE: e5", "MOVE: Nc6"])
    async with app.run_test(size=(170, 48)) as pilot:
        await play(pilot, "e4")
        await settle(app, pilot)
        moves = app.query_one("#moves")
        moves.focus()
        await pilot.press("left")
        assert app._index() == 1
        await pilot.press("home")
        assert app._index() == 0
        await pilot.press("right", "down")
        assert app._index() == 2
        await pilot.press("up", "end")
        assert app._live()
        await play(pilot, "Nf3")
        await settle(app, pilot)
        assert app._live()


async def test_browsing_stays_put_while_moves_arrive():
    app, _model = app_with(["MOVE: e5"], delay=0.3)
    async with app.run_test(size=(170, 48)) as pilot:
        await play(pilot, "e4")
        await pilot.pause(0.05)
        app.action_go(0)
        await settle(app, pilot)
        assert app.values["moves"] == ["e2e4", "e7e5"]
        assert app._index() == 0


async def test_flip_turns_the_board_and_the_strips():
    app, _model = app_with([])
    async with app.run_test(size=(170, 48)) as pilot:
        await pilot.press("ctrl+f")
        board = app.query_one("#board", ChessBoard)
        assert not board.state.white_bottom
        assert strip(app, "top").startswith("○ You")
        await pilot.click("#actions Button:last-of-type")
        assert board.state.white_bottom


async def test_resigning_asks_first():
    app, model = app_with(["MOVE: e5"])
    async with app.run_test(size=(170, 48)) as pilot:
        await pilot.press("ctrl+g")  # nothing played yet: there is nothing to resign
        assert not isinstance(app.screen, ConfirmResign)
        await play(pilot, "e4")
        await settle(app, pilot)
        await pilot.press("ctrl+g")
        await pilot.pause()
        assert isinstance(app.screen, ConfirmResign)
        await pilot.press("escape")
        await pilot.pause()
        assert app.values.get("outcome") is None
        await pilot.click("#resign")
        await pilot.pause()
        await pilot.click("#confirm")
        await settle(app, pilot)
        assert app.values["outcome"] == {
            "kind": "resignation",
            "winner": "black",
            "reason": "resigned",
        }
        assert text(app, "#headline") == "You lost · White resigned · Black wins"
        assert "0-1  White resigned · Black wins" in text(app, "#result")
        assert strip(app, "bottom") == "○ You | Resigned"
        assert strip(app, "top").endswith("| Won")
        assert app.query_one("#over").display
        assert not app.query_one("#actions").display
        assert model.calls == 1
        await play(pilot, "d4")
        await settle(app, pilot)
        assert app.values["moves"] == ["e2e4", "e7e5"]


async def test_a_draw_offer_is_declined_and_not_repeated():
    app, model = app_with(["MOVE: e5", "MOVE: Nc6"])
    async with app.run_test(size=(170, 48)) as pilot:
        await play(pilot, "e4")
        await settle(app, pilot)
        await pilot.press("ctrl+o")
        await settle(app, pilot)
        assert text(app, "#note") == "Draw declined."
        assert app.query_one("#draw", Button).disabled
        assert "½?" in text(app, "#move-rows")
        await play(pilot, "Nf3")
        await settle(app, pilot)
        assert text(app, "#note") == ""
        assert not app.query_one("#draw", Button).disabled
        assert model.calls == 2


async def test_a_custom_root_opens_with_a_position_packet():
    black_to_move = "4k3/8/8/8/8/8/4P3/4K3 b - - 0 1"
    app, model = app_with([RuntimeError("down"), "MOVE: Kd7"], start=black_to_move)
    async with app.run_test(size=(170, 48)) as pilot:
        await settle(app, pilot)
        assert app.failed == "down"
        # The packet opened a turn, so Retry resumes that turn like any other.
        assert app.first is None
        assert app.values["start_fen"] == black_to_move
        await pilot.press("ctrl+r")
        await settle(app, pilot)
        assert app.values["moves"] == ["e8d7"]
        assert model.calls == 2


async def test_a_position_packet_that_fails_before_any_turn_is_resent():
    black_to_move = "4k3/8/8/8/8/8/4P3/4K3 b - - 0 1"
    sent = []
    turn = {
        "id": "t1",
        "status": "pending",
        "calls": [],
        "latency_ms": 0.0,
        "initial_allowed": ["e8d7", "e8f7"],
        "illegal_attempts": 0,
    }
    accepted = {"start_fen": black_to_move, "turns": [turn]}

    class Unreachable:
        async def astream(self, payload, config, stream_mode):
            sent.append(payload)
            if len(sent) == 1:
                raise ConnectionError("no route")
            yield "values", accepted

        async def aget_state(self, config):
            return SimpleNamespace(values=accepted if len(sent) > 1 else {})

    app = ChessApp(
        lambda context, saver: Unreachable(),
        Game(LLM, "white", black_to_move),
        limit=lambda m: None,
    )
    async with app.run_test(size=(170, 48)) as pilot:
        await settle(app, pilot)
        assert app.failed == "no route"
        assert "Retry ^r" in [str(b.label) for b in app.query_one("#top").query(Button)]
        # No turn shows the failure, so the note does.
        assert text(app, "#note") == "The run failed: no route"
        await pilot.press("ctrl+r")
        await settle(app, pilot)
        assert sent == [{"position": {"start_fen": black_to_move}}] * 2
        assert app.first is None


async def test_the_first_move_from_a_custom_root_goes_in_the_packet():
    white_to_move = "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"
    app, _model = app_with(["MOVE: Kd7"], start=white_to_move)
    async with app.run_test(size=(170, 48)) as pilot:
        await play(pilot, "e5")
        await settle(app, pilot)
        assert "neither `go` nor a legal move" in text(app, "#note")
        await play(pilot, "resign white")
        await settle(app, pilot)
        assert text(app, "#note") == "You can't resign yet."
        await play(pilot, "e4")
        await settle(app, pilot)
        assert app.values["start_fen"] == white_to_move
        assert app.values["moves"] == ["e2e4", "e8d7"]


async def test_new_game_from_the_screen_and_cancel():
    app, _model = app_with(["MOVE: e5"], delay=60)
    async with app.run_test(size=(170, 48)) as pilot:
        await play(pilot, "e4")
        await pilot.pause(0.05)
        [run] = list(app.workers)
        first = app.thread
        await pilot.press("ctrl+n")
        await pilot.pause()
        assert isinstance(app.screen, NewGameScreen)
        await pilot.press("escape")
        await pilot.pause()
        assert app.thread == first
        await pilot.press("ctrl+n")
        await pilot.pause(0.5)
        app.screen.query_one("#play", Button).press()
        await settle(app, pilot)
        assert run.state == WorkerState.CANCELLED
        assert app.thread != first
        assert app.values == {}
        assert app.built == [LLM]  # the same opponent reuses its agent
        assert saved_threads(app) == set()


async def test_a_new_opponent_builds_its_agent_and_random_tosses_a_coin():
    app, _model = app_with(["MOVE: e4"], coin=0.9)
    async with app.run_test(size=(170, 48)) as pilot:
        await pilot.press("ctrl+n")
        await pilot.pause(0.5)
        screen = app.screen
        screen.query_one("#side").query("RadioButton")[1].value = True
        screen.query_one("#k", Input).value = "3"
        await pilot.pause()
        screen.query_one("#play", Button).press()
        await settle(app, pilot)
        assert app.game.side == "black"
        assert app.built[-1].k == 3
        assert app.values["moves"] == ["e2e4"]  # the opponent opened


async def test_rematch_swaps_sides():
    app, _model = app_with(["MOVE: e5", "MOVE: e4"])
    async with app.run_test(size=(170, 48)) as pilot:
        await play(pilot, "e4")
        await settle(app, pilot)
        app.action_resign()
        await pilot.pause()
        await pilot.click("#confirm")
        await settle(app, pilot)
        await pilot.click("#over Button")
        await settle(app, pilot)
        assert app.game.side == "black"
        assert app.values["moves"] == ["e2e4"]


async def test_export_from_the_command_palette(monkeypatch, tmp_path):
    app, _model = app_with(["MOVE: e5"])
    copied, opened = [], []
    monkeypatch.setattr(app, "copy_to_clipboard", copied.append)
    monkeypatch.setattr(app, "open_url", lambda url, new_tab=True: opened.append(url))
    monkeypatch.chdir(tmp_path)
    async with app.run_test(size=(170, 48)) as pilot:
        await play(pilot, "e4")
        await settle(app, pilot)
        titles = [c.title for c in app.get_system_commands(app.screen)]
        assert {"Copy PGN", "Copy FEN", "Save PGN", "Analyze on Lichess", "Flip board"} <= set(
            titles
        )
        app.action_copy_pgn()
        assert '[White "You"]' in copied[0]
        assert '[Black "GLM-5.3 Flash"]' in copied[0]
        assert f"Thread {app.thread}" in copied[0]
        app.action_go(1)
        app.action_copy_fen()
        assert copied[1] == "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
        app.action_save_pgn()
        assert os.listdir(tmp_path) == [f"langchain-chess-{app.thread}.pgn"]
        app.action_lichess()
        assert opened[0].startswith("https://lichess.org/analysis/pgn/")
        monkeypatch.setattr("langchain_chess_cli.tui.app.lichess_url", lambda pgn, fen: (fen, True))
        app.action_lichess()
        await pilot.pause()
        assert opened[1] == copied[1]


async def test_last_reply_moves_under_the_table_on_a_narrow_terminal():
    app, _model = app_with([])
    async with app.run_test(size=(170, 48)) as pilot:
        main = app.query_one("#main")
        assert [w.id for w in main.children] == ["reply", "board-col", "table"]
        await pilot.resize_terminal(120, 40)
        await pilot.pause()
        assert main.has_class("-narrow")
        assert [w.id for w in main.children] == ["board-col", "table", "reply"]
        await pilot.resize_terminal(121, 40)
        await pilot.pause()
        await pilot.resize_terminal(170, 48)
        await pilot.pause()
        assert [w.id for w in main.children] == ["reply", "board-col", "table"]


async def test_stages_open_and_close_and_the_theme_switches():
    context = ChessContext(policy="hybrid")
    app, _model = app_with(["MOVE: e5"], context=context)
    app.agent = create_chess_agent(
        ScriptedModel(script=["MOVE: e5"]), checkpointer=app.checkpointer
    )
    async with app.run_test(size=(170, 48)) as pilot:
        await play(pilot, "e4")
        await settle(app, pilot)
        stage = app.query_one("#stage-llm", Stage)
        await pilot.click("#stage-llm .stage-head")
        await pilot.pause()
        assert app.open_stages["llm"] is False
        assert not stage.query_one(".stage-body").display
        await pilot.click("#stage-llm .stage-head")
        await pilot.click("#stage-llm .stage-body")  # the body doesn't toggle
        assert app.open_stages["llm"] is True
        app.theme = "langchain-light"
        await pilot.pause()
        board = app.query_one("#board", ChessBoard)
        assert board.render_line(0).cell_length == board.size.width


async def test_model_and_error_text_is_shown_literally():
    app, _model = app_with([RuntimeError("bad [/] reply"), "Look [/] at [bold]this.\nMOVE: e5"])
    async with app.run_test(size=(170, 48)) as pilot:
        await play(pilot, "e4")
        await settle(app, pilot)
        assert "bad [/] reply" in text(app, "#llm-notes")
        await pilot.press("ctrl+r")
        await settle(app, pilot)
        assert "Look [/] at [bold]this." in analysis(app)
        await play(pilot, "[/]")
        await settle(app, pilot)
        assert "`[/]` is neither" in text(app, "#note")


async def test_typing_on_the_board_fills_the_input():
    app, _model = app_with(["MOVE: e5"])
    async with app.run_test(size=(170, 48)) as pilot:
        await pilot.pause()
        for key in "e4":
            await pilot.press(key)
            await pilot.pause()
        assert app.query_one("#move", Input).value == "e4"
        await pilot.press("enter")
        await settle(app, pilot)
        assert app.values["moves"] == ["e2e4", "e7e5"]
        assert app.focused is app.query_one("#board")


async def test_moves_by_clicking_the_board_and_the_move_list():
    app, _model = app_with(["MOVE: e5"])
    async with app.run_test(size=(170, 48)) as pilot:
        await pilot.pause()  # the board's geometry needs its first layout
        board = app.query_one("#board", ChessBoard)
        for square in ("e2", "e4"):
            x, y = board.geometry.origin(chess.parse_square(square))
            await pilot.click("#board", offset=(x + 1, y + 1))
            await pilot.pause()
        await settle(app, pilot)
        assert app.values["moves"] == ["e2e4", "e7e5"]
        await pilot.click("#move-rows", offset=(6, 0))
        await pilot.pause()
        assert app._index() == 1


def saved_threads(app):
    return {c.config["configurable"]["thread_id"] for c in app.checkpointer.list(None)}


async def test_a_late_failure_from_the_previous_game_is_ignored():
    app, _model = app_with([RuntimeError("late")], delay=0.3)
    async with app.run_test(size=(170, 48)) as pilot:
        await play(pilot, "e4")
        await pilot.pause(0.05)
        app._start_game(app.game)
        await settle(app, pilot)
        assert app.failed is None
        assert app.values == {}


async def test_typed_commands_take_the_same_path_as_their_keys():
    app, model = app_with(["MOVE: e5", "MOVE: Nf3"])
    async with app.run_test(size=(170, 48)) as pilot:
        await play(pilot, "draw white")
        await settle(app, pilot)
        assert text(app, "#note") == "You can't offer a draw now."
        await play(pilot, "go")
        await settle(app, pilot)
        assert text(app, "#note") == "It isn't the opponent's move."
        await play(pilot, "e4")
        await settle(app, pilot)
        # Whatever side is typed, it's the human's, and it asks first.
        await play(pilot, "resign black")
        await pilot.pause()
        assert isinstance(app.screen, ConfirmResign)
        await pilot.press("escape")
        await pilot.pause()
        app.game = Game(LLM, "black")  # now the opponent is to move
        await play(pilot, "go")
        await settle(app, pilot)
        assert app.values["moves"] == ["e2e4", "e7e5", "g1f3"]
        assert model.calls == 2


async def test_a_failed_turn_can_still_be_resigned_but_not_played_over():
    app, model = app_with([RuntimeError("down")])
    async with app.run_test(size=(170, 48)) as pilot:
        await play(pilot, "e4")
        await settle(app, pilot)
        assert app._pending()
        await play(pilot, "d4")
        await settle(app, pilot)
        assert app.values["moves"] == ["e2e4"]
        assert not app.query_one("#resign", Button).disabled
        await pilot.press("ctrl+g")
        await pilot.pause()
        await pilot.click("#confirm")
        await settle(app, pilot)
        assert app.values["outcome"]["reason"] == "resigned"
        await play(pilot, "d4")
        await settle(app, pilot)
        assert text(app, "#note") == "The game is over."
        assert model.calls == 1


async def test_typing_is_locked_while_browsing():
    app, model = app_with(["MOVE: e5"])
    async with app.run_test(size=(170, 48)) as pilot:
        await play(pilot, "e4")
        await settle(app, pilot)
        board = app.query_one("#board", ChessBoard)
        board.focus()
        await pilot.press("home")
        field = app.query_one("#move", Input)
        assert field.disabled
        assert field.placeholder == "Back to live to type a move"
        await pilot.press("d")  # typing on the board goes nowhere
        assert field.value == ""
        app._play("d4")
        await settle(app, pilot)
        assert app.values["moves"] == ["e2e4", "e7e5"]
        assert text(app, "#note") == "Back to live to move."
        await pilot.press("end")
        assert not field.disabled
        assert model.calls == 1


async def test_enter_in_the_new_game_screen_stays_there():
    app, model = app_with(["MOVE: e5"])
    async with app.run_test(size=(170, 48)) as pilot:
        await pilot.press("ctrl+n")
        await pilot.pause(0.5)
        start = app.screen.query_one("#start", Input)
        start.focus()
        start.value = "e4"
        await pilot.press("enter")
        await settle(app, pilot)
        assert start.value == "e4"
        assert isinstance(app.screen, NewGameScreen)
        assert model.calls == 0


async def test_an_opponent_that_cant_be_built_keeps_the_game_and_reopens_new_game():
    model = ScriptedModel(script=["MOVE: e5"])

    def factory(context, saver):
        if context.model == "unsupported:x":
            raise ValueError("Unsupported model provider: unsupported")
        return create_chess_agent(model, checkpointer=saver)

    app = ChessApp(factory, Game(LLM, "white"), limit=lambda m: None)
    async with app.run_test(size=(170, 48)) as pilot:
        await play(pilot, "e4")
        await settle(app, pilot)
        thread = app.thread
        await pilot.press("ctrl+n")
        await pilot.pause(0.5)
        screen = app.screen
        screen.query_one("#llm").value = "custom"
        screen.query_one("#custom-model", Input).value = "unsupported:x"
        await pilot.pause(0.5)
        screen.query_one("#play", Button).press()
        await pilot.pause()
        assert app.thread == thread
        assert app.values["moves"] == ["e2e4", "e7e5"]
        reopened = app.screen
        assert isinstance(reopened, NewGameScreen)
        assert reopened is not screen
        assert reopened.query_one("#custom-model", Input).value == "unsupported:x"


async def test_your_move_typed_on_the_agents_turn_says_whose_turn_it_is():
    app, _model = app_with(["MOVE: e5"], delay=60)
    async with app.run_test(size=(170, 48)) as pilot:
        notes = []
        app.notify = lambda message, **kw: notes.append(message)
        await play(pilot, "e4")
        await pilot.pause(0.05)
        assert app.running
        await play(pilot, "d4")
        await pilot.pause()
        assert notes == ["Wait for the agent, or retry its failed move."]
        app._start_game(app.game)  # cancels the run
        await settle(app, pilot)


async def test_your_move_typed_when_the_agent_should_move_says_so():
    app, _model = app_with(["MOVE: e5"])
    async with app.run_test(size=(170, 48)) as pilot:
        notes = []
        app.notify = lambda message, **kw: notes.append(message)
        await play(pilot, "e4")
        await settle(app, pilot)
        app.game = Game(LLM, "black")  # now it's the agent's move, and nothing runs
        await play(pilot, "d4")
        await settle(app, pilot)
        assert notes == ["It's the agent's move."]


async def test_actions_that_dont_apply_do_nothing():
    app, model = app_with([])
    async with app.run_test(size=(170, 48)) as pilot:
        # The palette offers them whatever the position.
        app.action_start()
        app.action_retry()
        app.action_resign()
        app.action_offer_draw()
        await pilot.pause()
        assert app.screen is app.screen_stack[0]
        assert model.calls == 0


async def test_a_retried_first_move_from_a_custom_root_still_counts_it():
    black_root = "4k3/8/8/8/8/8/4P3/4K3 b - - 0 41"
    sent = []

    class Down:
        async def astream(self, payload, config, stream_mode):
            sent.append(payload)
            raise ConnectionError("no route")
            yield

        async def aget_state(self, config):
            return SimpleNamespace(values={})

    app = ChessApp(
        lambda context, saver: Down(), Game(LLM, "black", black_root), limit=lambda m: None
    )
    async with app.run_test(size=(170, 48)) as pilot:
        await play(pilot, "Kd7")
        await settle(app, pilot)
        assert app.sent_from == "8/3k4/8/8/8/8/4P3/4K3 w - - 1 42"
        app.sent_from = ""
        await pilot.press("ctrl+r")
        await settle(app, pilot)
        assert sent == [{"position": {"start_fen": black_root, "moves": ["e8d7"]}}] * 2
        assert app.sent_from == "8/3k4/8/8/8/8/4P3/4K3 w - - 1 42"


async def test_a_new_llm_attempt_replaces_the_last_ones_analysis():
    release = asyncio.Event()

    class Attempts:
        async def astream(self, payload, config, stream_mode):
            for text, message in (("First attempt: ", "a"), ("MOVE: Qh8", "a"), ("Second", "b")):
                chunk = AIMessageChunk(content=text, id=message)
                yield "messages", (chunk, {"langgraph_node": "model"})
            await release.wait()

        async def aget_state(self, config):
            return SimpleNamespace(values={})

    app = ChessApp(lambda context, saver: Attempts(), Game(LLM, "black"), limit=lambda m: None)
    async with app.run_test(size=(170, 48)) as pilot:
        await pilot.pause()
        assert app.analysis == "Second"
        release.set()
        await settle(app, pilot)
