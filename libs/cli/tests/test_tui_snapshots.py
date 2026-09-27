"""Visual regressions: `pytest --snapshot-update` rewrites them after a deliberate change.

Open the SVGs under `__snapshots__/` and look at them before accepting an update.
"""

import chess
import pytest
from textual.app import App, ComposeResult

from langchain_chess import create_chess_agent
from langchain_chess.testing import ScriptedModel
from langchain_chess_cli.tui.app import ChessApp
from langchain_chess_cli.tui.board import ChessBoard
from langchain_chess_systemone.settings import ChessContext

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


def test_the_game_screen(snap_compare):
    model = ScriptedModel(script=["The Italian keeps options open.\nMOVE: e5"])
    app = ChessApp(
        lambda saver: create_chess_agent(model, checkpointer=saver),
        ChessContext(policy="llm"),
    )

    async def play_e4(pilot):
        await pilot.press("e", "4", "enter")
        await pilot.app.workers.wait_for_complete()
        await pilot.pause()

    assert snap_compare(app, terminal_size=(150, 45), run_before=play_e4)
