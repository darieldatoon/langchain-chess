"""Visual regressions: `pytest --snapshot-update` rewrites them after a deliberate change.

Open the SVGs under `__snapshots__/` and look at them before accepting an update.
"""

from types import SimpleNamespace

import chess
import pytest
from textual.app import App, ComposeResult

from langchain_chess.testing import ScriptedModel
from langchain_chess_cli.tui.app import ChessApp, Game
from langchain_chess_cli.tui.board import ChessBoard
from langchain_chess_systemone.agent import build_agent
from langchain_chess_systemone.settings import ChessContext
from langchain_chess_systemone.testing import FakeRanker, distribution

AFTER_E4_E5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2"


class BoardApp(App[None]):
    def __init__(
        self, fen: str = AFTER_E4_E5, *, white_bottom: bool = True, last_move: str = "e7e5"
    ) -> None:
        super().__init__()
        self.fen, self.white_bottom, self.last_move = fen, white_bottom, last_move

    def compose(self) -> ComposeResult:
        yield ChessBoard(id="board")

    def on_mount(self) -> None:
        board = self.query_one(ChessBoard)
        board.show(
            chess.Board(self.fen),
            white_bottom=self.white_bottom,
            last_move=self.last_move,
            interactive=True,
        )
        board.focus()


@pytest.mark.parametrize(
    "size", [(60, 18), (100, 34), (150, 45)], ids=["small", "compact", "large"]
)
def test_board_sizes(snap_compare, size):
    assert snap_compare(BoardApp(), terminal_size=size)


def test_a_selected_piece_shows_its_moves(snap_compare):
    async def select_knight(pilot):
        await pilot.pause()  # the board's geometry needs its first layout
        board = pilot.app.query_one(ChessBoard)
        x, y = board.geometry.origin(chess.G1)
        await pilot.click("#board", offset=(x + 1, y))

    assert snap_compare(BoardApp(), terminal_size=(100, 34), run_before=select_knight)


def test_blacks_side_with_the_cursor(snap_compare):
    async def shows_e4(pilot):
        assert pilot.app.query_one(ChessBoard).state.last_move == (chess.E2, chess.E4)

    black = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
    assert snap_compare(
        BoardApp(black, white_bottom=False, last_move="e2e4"),
        terminal_size=(100, 34),
        press=["up", "left"],
        run_before=shows_e4,
    )


def test_the_promotion_dialog(snap_compare):
    async def promote(pilot):
        await pilot.pause()
        board = pilot.app.query_one(ChessBoard)
        assert board.state.last_move == (chess.H8, chess.H7)
        for square in (chess.A7, chess.A8):
            x, y = board.geometry.origin(square)
            await pilot.click("#board", offset=(x + 1, y))

    app = BoardApp("8/P6k/8/8/8/8/8/K7 w - - 0 1", last_move="h8h7")
    assert snap_compare(app, terminal_size=(100, 34), run_before=promote)


def hybrid_game(monkeypatch, *script):
    """Jev hands e4's reply to the LLM, then plays Nf3's reply alone."""
    # The screen prints measured latencies; a slow runner would change them.
    monkeypatch.setattr(
        "langchain_chess.middleware.core.time", SimpleNamespace(perf_counter=lambda: 0.0)
    )
    ranker = FakeRanker(
        [
            distribution({"e7e5": 0.55, "c7c5": 0.35, "e7e6": 0.1}, latency_ms=820.0),
            distribution({"b8c6": 0.97, "g8f6": 0.03}, latency_ms=640.0),
        ]
    )
    model = ScriptedModel(
        script=list(
            script or ["The **Italian** keeps options open.\n\n- e5 claims the centre\nMOVE: e5"]
        )
    )

    def factory(context, saver):
        return build_agent(
            context,
            model_factory=lambda _: model,
            ranker_factory=lambda _: ranker,
            checkpointer=saver,
        )

    return ChessApp(factory, Game(ChessContext(), "white"), limit=lambda m: 1000)


async def play_two(pilot):
    for move in ("e4", "Nf3"):
        await pilot.press(*move, "enter")
        await pilot.app.workers.wait_for_complete()
        await pilot.pause()


def test_the_game_screen(snap_compare, monkeypatch):
    assert snap_compare(hybrid_game(monkeypatch), terminal_size=(170, 48), run_before=play_two)


def test_the_light_theme_on_a_narrow_terminal(snap_compare, monkeypatch):
    async def light(pilot):
        await play_two(pilot)
        pilot.app.theme = "langchain-light"
        await pilot.pause()

    app = hybrid_game(monkeypatch)
    assert snap_compare(app, terminal_size=(130, 44), run_before=light)


def test_stepping_back_shows_the_reply_before_the_move(snap_compare, monkeypatch):
    async def back(pilot):
        await play_two(pilot)
        await pilot.press("comma", "comma")
        await pilot.pause()

    assert snap_compare(hybrid_game(monkeypatch), terminal_size=(170, 48), run_before=back)


def test_the_game_over(snap_compare, monkeypatch):
    async def resign(pilot):
        await play_two(pilot)
        await pilot.press("ctrl+g")
        await pilot.pause()
        await pilot.click("#confirm")
        await pilot.app.workers.wait_for_complete()
        await pilot.pause()

    app = hybrid_game(monkeypatch)
    assert snap_compare(app, terminal_size=(170, 48), run_before=resign)


def test_the_new_game_screen(snap_compare, monkeypatch):
    async def open_it(pilot):
        await pilot.press("ctrl+n")
        await pilot.pause(0.5)

    app = hybrid_game(monkeypatch)
    assert snap_compare(app, terminal_size=(130, 48), run_before=open_it)


def test_a_stopped_turn_offers_retry(snap_compare, monkeypatch):
    async def fail(pilot):
        await pilot.press(*"e4", "enter")
        await pilot.app.workers.wait_for_complete()
        await pilot.pause()

    app = hybrid_game(monkeypatch, RuntimeError("the provider timed out"))
    assert snap_compare(app, terminal_size=(170, 48), run_before=fail)


def test_advanced_settings_with_an_invalid_field(snap_compare, monkeypatch):
    async def invalid(pilot):
        await pilot.press("ctrl+n")
        await pilot.pause(0.5)
        screen = pilot.app.screen
        screen.query_one("#advanced").collapsed = False
        await pilot.pause()
        screen.query_one("#k").value = "0"
        screen.query_one("#k").focus()
        await pilot.pause()

    app = hybrid_game(monkeypatch)
    assert snap_compare(app, terminal_size=(130, 48), run_before=invalid)


def test_a_short_terminal(snap_compare, monkeypatch):
    assert snap_compare(hybrid_game(monkeypatch), terminal_size=(100, 30), run_before=play_two)


def test_a_narrow_terminal_stacks_the_table_under_the_board(snap_compare, monkeypatch):
    assert snap_compare(hybrid_game(monkeypatch), terminal_size=(50, 30), run_before=play_two)
