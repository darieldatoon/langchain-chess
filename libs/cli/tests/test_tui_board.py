import chess
import pytest
from rich.style import Style
from textual.app import App, ComposeResult
from textual.widgets import Input

from langchain_chess_cli.tui.board import (
    ROLES,
    ChessBoard,
    Marks,
    PromotionScreen,
    arrow,
    draw,
    geometry,
)
from langchain_chess_cli.tui.pieces import piece_lines, piece_size

PROMOTE = "8/P6k/8/8/8/8/8/K7 w - - 0 1"
# A distinct colour per role, so tests can read which role styled a cell.
FOREGROUND = {"white-piece", "black-piece", "target", "label"}
PALETTE = {
    role: Style(color=f"color({i})") if role in FOREGROUND else Style(bgcolor=f"color({i})")
    for i, role in enumerate(ROLES, start=1)
}


def role_of(style):
    return next(
        r for r, s in PALETTE.items() if s.bgcolor is not None and s.bgcolor == style.bgcolor
    )


def text(line):
    return "".join(segment.text for segment in line)


def style_at(lines, x, y):
    position = 0
    for segment in lines[y]:
        if position <= x < position + len(segment.text):
            return segment.style
        position += len(segment.text)
    raise AssertionError


def test_geometry_fits_the_space_and_centres_the_board():
    geo = geometry(120, 41, white_bottom=True)
    assert (geo.square_height, geo.square_width) == (5, 11)
    assert geo.width == 90
    assert geo.height == 41
    assert geo.left == 15
    assert geometry(20, 5, white_bottom=True).square_height == 1
    tall = geometry(60, 100, white_bottom=True)
    assert tall.square_height == 3


@pytest.mark.parametrize("white_bottom", [True, False])
def test_square_at_inverts_origin(white_bottom):
    geo = geometry(100, 33, white_bottom=white_bottom)
    for square in chess.SQUARES:
        x, y = geo.origin(square)
        assert geo.square_at(x + geo.square_width - 1, y + geo.square_height - 1) == square
    assert geo.square_at(0, 0) is None
    assert geo.square_at(geo.left + 2, geo.height) is None
    assert geo.square_at(geo.left + geo.width, 0) is None
    corner = chess.A8 if white_bottom else chess.H1
    assert geo.square_at(geo.left + 2, 0) == corner


def test_piece_sizes_and_art():
    assert [piece_size(h) for h in (1, 2, 3, 4, 5, 9)] == [
        "small",
        "small",
        "compact",
        "extended",
        "large",
        "large",
    ]
    assert piece_lines(chess.Piece(chess.KING, chess.WHITE), "small") == ["♔"]
    assert piece_lines(chess.Piece(chess.KNIGHT, chess.BLACK), "small") == ["♞"]
    for size, rows in (("compact", 3), ("extended", 4), ("large", 5)):
        for piece_type in chess.PIECE_TYPES:
            assert len(piece_lines(chess.Piece(piece_type, chess.WHITE), size)) == rows


def test_draw_labels_pieces_and_marks():
    board = chess.Board()
    board.push_uci("e2e4")
    board.push_uci("f7f6")
    board.push_uci("d1h5")  # check
    geo = geometry(58, 25, white_bottom=True)  # 3-row squares
    marks = Marks(
        cursor=chess.A1,
        selected=chess.G8,
        targets=frozenset({chess.H6, chess.H5}),
        last_move=(chess.D1, chess.H5),
        check=chess.E8,
    )
    lines = draw(board, geo, marks, PALETTE)
    assert len(lines) == geo.height
    assert text(lines[1]).strip().startswith("8")
    assert text(lines[-1]).split() == list("abcdefgh")
    rows = geo.square_height

    def square_role(square):
        x, y = geo.origin(square)
        return role_of(style_at(lines, x, y))

    assert square_role(chess.A1) == "cursor"
    assert square_role(chess.G8) == "selected"
    assert square_role(chess.E8) == "check"
    assert square_role(chess.H5) == "capture"  # a target holding a piece
    assert square_role(chess.D1) == "last-light"
    assert square_role(chess.B1) == "light"
    assert square_role(chess.C1) == "dark"
    _, y = geo.origin(chess.H6)
    assert "●" in text(lines[y + (rows - 1) // 2])
    assert "▗▂╋▂▖" in text(lines[geo.origin(chess.E1)[1]])  # the white king's compact art


def test_draw_from_blacks_side():
    lines = draw(chess.Board(), geometry(40, 17, white_bottom=False), Marks(), PALETTE)
    assert text(lines[0]).strip().startswith("1")
    assert text(lines[-1]).split() == list("hgfedcba")
    assert "♖" in text(lines[0])


def test_arrow_steps_on_screen_and_clamps():
    assert arrow(chess.E2, "up", white_bottom=True) == chess.E3
    assert arrow(chess.E2, "up", white_bottom=False) == chess.E1
    assert arrow(chess.E2, "left", white_bottom=True) == chess.D2
    assert arrow(chess.E2, "left", white_bottom=False) == chess.F2
    assert arrow(chess.A1, "down", white_bottom=True) == chess.A1
    assert arrow(chess.H8, "right", white_bottom=True) == chess.H8


class Host(App[None]):
    def __init__(self, fen=chess.STARTING_FEN, *, white_bottom=True, interactive=True):
        super().__init__()
        self.fen, self.white_bottom, self.interactive = fen, white_bottom, interactive
        self.moves: list[str] = []
        self.typed: list[str] = []

    def compose(self) -> ComposeResult:
        yield ChessBoard(id="board")
        yield Input(id="move")

    def on_mount(self) -> None:
        board = self.query_one(ChessBoard)
        board.show(
            chess.Board(self.fen),
            white_bottom=self.white_bottom,
            last_move=None,
            interactive=self.interactive,
        )
        board.focus()

    def on_chess_board_moved(self, message: ChessBoard.Moved) -> None:
        self.moves.append(message.uci)

    def on_chess_board_typed(self, message: ChessBoard.Typed) -> None:
        self.typed.append(message.character)


async def click(pilot, square):
    board = pilot.app.query_one(ChessBoard)
    x, y = board.geometry.origin(square)
    await pilot.click("#board", offset=(x + 1, y))
    await pilot.pause()


async def test_click_a_piece_then_its_target():
    app = Host()
    async with app.run_test(size=(100, 30)) as pilot:
        await click(pilot, chess.E2)
        board = app.query_one(ChessBoard)
        assert board.state.selected == chess.E2
        assert board.targets() == {chess.E3, chess.E4}
        await click(pilot, chess.E4)
        assert app.moves == ["e2e4"]
        assert board.state.selected is None


async def test_reselect_deselect_and_ignore():
    app = Host()
    async with app.run_test(size=(100, 30)) as pilot:
        board = app.query_one(ChessBoard)
        await click(pilot, chess.E7)  # the opponent's piece
        assert board.state.selected is None
        await click(pilot, chess.E2)
        await click(pilot, chess.G1)  # another own piece: reselect
        assert board.state.selected == chess.G1
        await click(pilot, chess.G1)  # the same piece again: deselect
        assert board.state.selected is None
        await click(pilot, chess.G1)
        await click(pilot, chess.E5)  # not a target: deselect
        assert board.state.selected is None
        await pilot.click("#board", offset=(0, 0))  # outside the squares
        assert app.moves == []


async def test_keyboard_play_from_blacks_side():
    board_fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
    app = Host(board_fen, white_bottom=False)
    async with app.run_test(size=(100, 30)) as pilot:
        board = app.query_one(ChessBoard)
        board.state.cursor = chess.E7
        for key in ("enter", "up", "up"):  # up on screen is toward rank 1 for Black
            await pilot.press(key)
        assert board.state.cursor == chess.E5
        await pilot.press("space")
        assert app.moves == ["e7e5"]
        await pilot.press("left", "right", "down", "enter", "escape")
        assert board.state.selected is None


async def test_typing_is_handed_to_the_input():
    app = Host()
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.press("N", "f", "3")
        assert app.typed == ["N", "f", "3"]


async def test_not_interactive_rings_the_bell():
    app = Host(interactive=False)
    async with app.run_test(size=(100, 30)) as pilot:
        await click(pilot, chess.E2)
        assert app.query_one(ChessBoard).state.selected is None


async def test_promotion_by_click_key_and_cancel():
    app = Host(PROMOTE)
    async with app.run_test(size=(100, 30)) as pilot:
        await click(pilot, chess.A7)
        await click(pilot, chess.A8)
        assert isinstance(app.screen, PromotionScreen)
        await pilot.click("#promote-n")
        await pilot.pause()
        await click(pilot, chess.A7)
        await click(pilot, chess.A8)
        await pilot.press("r")
        await pilot.pause()
        await click(pilot, chess.A7)
        await click(pilot, chess.A8)
        await pilot.press("escape")
        await pilot.pause()
        assert app.moves == ["a7a8n", "a7a8r"]


async def test_a_new_position_clears_the_selection_and_blank_rows_render():
    app = Host()
    async with app.run_test(size=(100, 30)) as pilot:
        board = app.query_one(ChessBoard)
        await click(pilot, chess.E2)
        board.show(chess.Board(PROMOTE), white_bottom=True, last_move="e2e4", interactive=True)
        assert board.state.selected is None
        assert board.state.last_move == (chess.E2, chess.E4)
        assert board.render_line(500).cell_length == board.size.width
        app.query_one(Input).focus()
        await pilot.pause()
        assert board.marks().cursor is None


async def test_the_board_renders_in_monochrome(monkeypatch):
    monkeypatch.setenv("NO_COLOR", "1")
    app = Host()
    async with app.run_test(size=(120, 60)) as pilot:  # wider and taller than the board
        await click(pilot, chess.E2)
        assert app.no_color
        assert app.query_one(ChessBoard).state.selected == chess.E2
