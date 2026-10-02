import chess
from textual.app import App, ComposeResult
from textual.widgets import Markdown, Static

from langchain_chess_cli.tui.reply import FORCED, PIPELINES, Pending, Played
from langchain_chess_cli.tui.theme import THEMES
from langchain_chess_cli.tui.view import Entry, move_rows
from langchain_chess_cli.tui.widgets import MoveList, ReplyPanel, _extra, bars

AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
OPEN = {"systemone": True, "llm": True}


class Host(App[None]):
    def compose(self) -> ComposeResult:
        yield ReplyPanel(id="reply")
        yield MoveList(id="moves")

    def on_mount(self) -> None:
        for theme in THEMES:
            self.register_theme(theme)


def text(app, selector):
    return str(app.query_one(selector, Static).render())


def turn(status="committed", calls=()):
    return {
        "id": "t",
        "status": status,
        "calls": list(calls),
        "latency_ms": 900.0,
        "initial_allowed": ["a", "b"],
        "illegal_attempts": 0,
    }


def meta(status, **extra):
    return {
        "status": status,
        "model": "semif",
        "top": [{"uci": "c7c5", "probability": 0.7}, {"uci": "e7e5", "probability": 0.2}],
        "shortlist": [],
        "gate": "margin",
        "signal": 0.5,
        "threshold_used": 0.9,
        "tournament": None,
        "latency_ms": 300.0,
        "error": None,
        **extra,
    }


def played(source, systemone, uci="e7e5", san="e5", stages="hybrid"):
    ply = {
        "ply": 1,
        "uci": uci,
        "san": san,
        "source": source,
        "turn_id": "t",
        "latency_ms": 900.0,
        "model": None,
        "analysis": None,
        "meta": {"SystemOneMiddleware": systemone} if systemone else {},
    }
    return Played(ply, turn(), AFTER_E4, PIPELINES[stages])


async def test_a_stopped_turn_and_a_skipped_system_one():
    app = Host()
    async with app.run_test(size=(80, 60)) as pilot:
        panel = app.query_one(ReplyPanel)
        stopped = Pending(
            turn("pending"), AFTER_E4, PIPELINES["hybrid"], None, "", False, "timeout"
        )
        panel.show(stopped, title="Last reply", open_stages=OPEN, game=None)
        await pilot.pause()
        assert text(app, "#systemone-body") == "System 1 didn't finish: timeout"
        assert "Stopped" in text(app, "#reply-head")
        assert text(app, "#llm-notes") == "timeout"
        assert "No analysis before it stopped." in app.query_one("#analysis", Markdown).source
        quiet = Pending(turn("pending"), AFTER_E4, PIPELINES["hybrid"], None, "", False, None)
        panel.show(quiet, title="Last reply", open_stages=OPEN, game=None)
        await pilot.pause()
        assert text(app, "#systemone-body") == "System 1 didn't finish."
        skipped = played("llm", meta("skipped", error="rate limited"))
        panel.show(skipped, title="Last reply", open_stages=OPEN, game=None)
        await pilot.pause()
        assert text(app, "#systemone-body") == "System 1 skipped: rate limited"
        assert "No analysis." in app.query_one("#analysis", Markdown).source


async def test_system_one_alone_and_a_move_outside_its_top_moves():
    app = Host()
    async with app.run_test(size=(80, 60)) as pilot:
        panel = app.query_one(ReplyPanel)
        alone = played("systemone", meta("played"), uci="c7c5", san="c5", stages="systemone")
        panel.show(alone, title="Last reply", open_stages=OPEN, game=None)
        await pilot.pause()
        body = text(app, "#systemone-body")
        assert "c5" in body
        assert "Confident" not in body  # no gate without an LLM
        assert not app.query_one("#stage-llm").display
        result = [{"round": 1, "heat": None, "rank": 7, "probability": 0.01, "bye": False}]
        outside = played("llm", meta("shortlist", played_move_result=result), uci="d7d5", san="d5")
        panel.show(outside, title="Last reply", open_stages=OPEN, game=None)
        await pilot.pause()
        lines = text(app, "#systemone-body").splitlines()
        assert lines[3] == "…"
        assert lines[4].startswith("d5")
        assert "d5: not in System 1's top 2" in text(app, "#llm-notes")
        no_gate = played("llm", meta("shortlist", signal=None))
        panel.show(no_gate, title="Last reply", open_stages=OPEN, game=None)
        await pilot.pause()
        assert "confident" not in text(app, "#systemone-body")
        forced = Played(outside.ply, None, AFTER_E4, FORCED)
        panel.show(forced, title="Last reply", open_stages=OPEN, game=None)
        await pilot.pause()
        assert not app.query_one("#stage-systemone").display


def test_a_heat_result_never_counts_as_outside_the_top_moves():
    in_heat = [{"round": 1, "heat": 2, "rank": 1, "probability": 0.5, "bye": False}]
    reply = played("llm", meta("shortlist", played_move_result=in_heat), uci="d7d5", san="d5")
    assert _extra(reply.ply, meta("shortlist")["top"]) is None
    # A ranked move that isn't legal here keeps its UCI.
    assert "h2h4" in str(bars([{"uci": "h2h4", "probability": 0.1}], AFTER_E4, None, None))
    assert "Nf6" in str(bars([{"uci": "g8f6", "probability": 0.1}], AFTER_E4, None, None))


async def test_analysis_writes_are_serialized_and_the_latest_wins():
    app = Host()
    async with app.run_test(size=(80, 60)) as pilot:
        panel = app.query_one(ReplyPanel)
        for text_so_far in (
            "first paragraph",
            "first paragraph\n\nsecond",
            "first paragraph\n\nsecond!",
        ):
            pending = Pending(
                turn("pending"), AFTER_E4, PIPELINES["llm"], None, text_so_far, True, None
            )
            panel.show(pending, title="Last reply", open_stages=OPEN, game=None)
        await app.workers.wait_for_complete()
        await pilot.pause()
        markdown = app.query_one("#analysis", Markdown)
        assert markdown.source == "first paragraph\n\nsecond!"
        assert [str(block._content) for block in markdown.children].count("first paragraph") == 1
        grown = Pending(
            turn("pending"),
            AFTER_E4,
            PIPELINES["llm"],
            None,
            "first paragraph\n\nsecond!\n\nthird",
            True,
            None,
        )
        panel.show(grown, title="Last reply", open_stages=OPEN, game=None)
        await app.workers.wait_for_complete()
        assert markdown.source == "first paragraph\n\nsecond!\n\nthird"
        replaced = Pending(
            turn("pending"), AFTER_E4, PIPELINES["llm"], None, "another try", True, None
        )
        panel.show(replaced, title="Last reply", open_stages=OPEN, game=None)
        await app.workers.wait_for_complete()
        assert markdown.source == "another try"


async def laid_out(pilot):
    """Scrolling waits for the layout after an update: give it the refresh it waits for."""
    await pilot.pause()
    await pilot.pause(0.05)


def rows(count):
    plies = [Entry(i, f"a{i}", "llm") for i in range(count)]
    return move_rows(plies, chess.STARTING_FEN)


async def test_new_moves_follow_the_end_only_for_a_reader_there():
    app = Host()
    async with app.run_test(size=(80, 20)) as pilot:
        moves = app.query_one(MoveList)
        moves.show(rows(60), selected=59, opening=None, result=None, draws=frozenset())
        await laid_out(pilot)
        assert moves._latest_in_view()
        moves.show(rows(61), selected=60, opening=None, result=None, draws=frozenset())
        await laid_out(pilot)
        assert moves.scroll_y == moves.max_scroll_y
        moves.scroll_to(y=0, animate=False)
        await laid_out(pilot)
        moves.show(rows(62), selected=61, opening=None, result=None, draws=frozenset())
        await laid_out(pilot)
        assert moves.scroll_y == 0
        # Going to a move centres it.
        moves.show(rows(62), selected=30, opening="A00 · Opening", result=None, draws=frozenset())
        await laid_out(pilot)
        assert 0 < moves.scroll_y < moves.max_scroll_y
        app.theme = "langchain-light"
        await laid_out(pilot)
        assert text(app, "#opening") == "A00 · Opening"


async def test_a_theme_change_before_any_moves_is_harmless():
    app = Host()
    async with app.run_test(size=(80, 20)) as pilot:
        app.theme = "langchain-light"
        await pilot.pause()
        assert text(app, "#move-rows") == ""


async def test_a_wrapped_opening_heading_counts_in_what_is_in_view():
    app = Host()
    async with app.run_test(size=(30, 20)) as pilot:
        moves = app.query_one(MoveList)
        long = "B96 · Sicilian Defense: Najdorf Variation, Polugaevsky Variation"
        moves.show(rows(22), selected=21, opening=long, result=None, draws=frozenset({-1}))
        await laid_out(pilot)
        heading = app.query_one("#opening", Static).outer_size.height
        assert heading > 1
        assert moves._line_of(0) == heading + 1
        # The last move is the first line below the view.
        moves.scroll_to(y=moves._line_of(10) - moves.size.height, animate=False)
        await laid_out(pilot)
        assert not moves._latest_in_view()
        before = moves.scroll_y
        moves.show(rows(23), selected=22, opening=long, result=None, draws=frozenset({-1}))
        await laid_out(pilot)
        assert moves.scroll_y == before
