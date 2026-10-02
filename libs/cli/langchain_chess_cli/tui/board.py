"""The board widget: drawn squares and pieces, played with the mouse or the keyboard.

Click a piece then its target, or move the cursor with the arrow keys and press Enter twice.
Typing any other character hands it to the notation input. Layout and drawing are pure;
`ChessBoard` holds the interaction state.
"""

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import ClassVar

import chess
from rich.segment import Segment
from rich.style import Style
from textual import events
from textual.app import ComposeResult
from textual.binding import Binding, BindingType
from textual.containers import Horizontal, Vertical
from textual.message import Message
from textual.screen import ModalScreen
from textual.strip import Strip
from textual.widget import Widget
from textual.widgets import Button, Label

from langchain_chess_cli.tui.pieces import piece_lines, piece_size
from langchain_chess_cli.tui.theme import DARK_BOARD

LABEL_WIDTH = 2
PROMOTIONS = (("q", "Queen"), ("r", "Rook"), ("b", "Bishop"), ("n", "Knight"))
SQUARES = ("light", "dark", "last-move", "cursor", "selected", "capture", "check")
"""Roles drawn as a square's background, from the theme's `board-<role>` variables."""
INKS = ("white-piece", "black-piece", "target", "label")
"""Roles drawn as a foreground colour, from the theme's `board-<role>` variables."""
NOTATION = frozenset("abcdefghKQRBNO0")
"""What a typed move or `go` starts with; typing on moves focus to the input, which takes the
rest. Other keys are left to the app's bindings."""

type Palette = dict[str, Style]
"""A rich style per role."""
type Line = list[Segment]


def palette(variables: Mapping[str, str]) -> Palette:
    """The board's styles from a theme's variables; a theme without them gets the dark board's."""

    def color(role: str) -> str:
        return variables.get(f"board-{role}", DARK_BOARD[f"board-{role}"])

    styles = {role: Style(bgcolor=color(role)) for role in SQUARES}
    styles |= {role: Style(color=color(role)) for role in INKS}
    styles["white-piece"] += Style(bold=True)
    styles["black-piece"] += Style(bold=True)
    return styles


@dataclass(frozen=True, slots=True)
class Geometry:
    square_height: int
    square_width: int
    left: int
    white_bottom: bool

    @property
    def width(self) -> int:
        return LABEL_WIDTH + 8 * self.square_width

    @property
    def height(self) -> int:
        return 8 * self.square_height + 1

    def _row_col(self, square: chess.Square) -> tuple[int, int]:
        rank, file = chess.square_rank(square), chess.square_file(square)
        return (7 - rank, file) if self.white_bottom else (rank, 7 - file)

    def origin(self, square: chess.Square) -> tuple[int, int]:
        """The square's top-left cell."""
        row, col = self._row_col(square)
        return self.left + LABEL_WIDTH + col * self.square_width, row * self.square_height

    def square_at(self, x: int, y: int) -> chess.Square | None:
        col, row = (x - self.left - LABEL_WIDTH), y
        if col < 0 or row < 0 or col >= 8 * self.square_width or row >= 8 * self.square_height:
            return None
        col, row = col // self.square_width, row // self.square_height
        if self.white_bottom:
            return chess.square(col, 7 - row)
        return chess.square(7 - col, row)


def geometry(width: int, height: int, *, white_bottom: bool) -> Geometry:
    """The largest board that fits, with squares about as wide on screen as they are tall."""
    square_height = max(1, min((height - 1) // 8, (width - LABEL_WIDTH - 8) // 16))
    square_width = 2 * square_height + 1
    board_width = LABEL_WIDTH + 8 * square_width
    return Geometry(square_height, square_width, max(0, (width - board_width) // 2), white_bottom)


@dataclass(frozen=True, slots=True)
class Marks:
    """Everything highlighted on the board."""

    cursor: chess.Square | None = None
    selected: chess.Square | None = None
    targets: frozenset[chess.Square] = frozenset()
    last_move: tuple[chess.Square, chess.Square] | None = None
    check: chess.Square | None = None


def background_role(square: chess.Square, board: chess.Board, marks: Marks) -> str:
    light = (chess.square_rank(square) + chess.square_file(square)) % 2 == 1
    if square == marks.selected:
        return "selected"
    if square == marks.cursor:
        return "cursor"
    if square == marks.check:
        return "check"
    if square in marks.targets and board.piece_at(square) is not None:
        return "capture"
    if marks.last_move is not None and square in marks.last_move:
        return "last-move"
    return "light" if light else "dark"


def _square_rows(
    square: chess.Square, board: chess.Board, geo: Geometry, marks: Marks, palette: Palette
) -> list[Segment]:
    """The square's rows, top to bottom, each exactly `square_width` cells."""
    background = palette[background_role(square, board, marks)]
    height, width = geo.square_height, geo.square_width
    rows = [Segment(" " * width, background)] * height
    piece = board.piece_at(square)
    if piece is not None:
        color = palette["white-piece" if piece.color == chess.WHITE else "black-piece"]
        art = piece_lines(piece, piece_size(height))
        top = (height - len(art)) // 2
        for index, line in enumerate(art):
            rows[top + index] = Segment(line.center(width), background + color)
    elif square in marks.targets:
        rows[(height - 1) // 2] = Segment("●".center(width), background + palette["target"])
    return rows


def draw(board: chess.Board, geo: Geometry, marks: Marks, palette: Palette) -> list[Line]:
    """Every row of the board, rank labels on the left and file labels underneath."""
    lines: list[Line] = []
    ranks = range(7, -1, -1) if geo.white_bottom else range(8)
    files = list(range(8)) if geo.white_bottom else list(range(7, -1, -1))
    pad = Segment(" " * geo.left, Style.null())
    label_style = palette["label"]
    for rank in ranks:
        squares = [_square_rows(chess.square(f, rank), board, geo, marks, palette) for f in files]
        for inner in range(geo.square_height):
            label = str(rank + 1) if inner == (geo.square_height - 1) // 2 else " "
            lines.append(
                [pad, Segment(f"{label} ", label_style), *(rows[inner] for rows in squares)]
            )
    footer = "".join(chess.FILE_NAMES[f].center(geo.square_width) for f in files)
    lines.append([pad, Segment(" " * LABEL_WIDTH + footer, label_style)])
    return lines


def arrow(square: chess.Square, key: str, *, white_bottom: bool) -> chess.Square:
    """The square one step away on screen, clamped to the board."""
    file, rank = chess.square_file(square), chess.square_rank(square)
    step = 1 if white_bottom else -1
    df, dr = {"up": (0, step), "down": (0, -step), "left": (-step, 0), "right": (step, 0)}[key]
    return chess.square(min(7, max(0, file + df)), min(7, max(0, rank + dr)))


class PromotionScreen(ModalScreen[str | None]):
    """Choose the promotion piece: click it or press its letter."""

    DEFAULT_CSS = """
    PromotionScreen { align: center middle; }
    #promotion { width: auto; height: auto; border: round $accent; padding: 1 2; }
    #promotion Horizontal { width: auto; height: auto; }
    """
    BINDINGS: ClassVar[list[BindingType]] = [
        Binding("q", "choose('q')", "Queen", show=False),
        Binding("r", "choose('r')", "Rook", show=False),
        Binding("b", "choose('b')", "Bishop", show=False),
        Binding("n", "choose('n')", "Knight", show=False),
        Binding("escape", "choose('')", "Cancel", show=False),
    ]

    def compose(self) -> ComposeResult:
        with Vertical(id="promotion"):
            yield Label("Promote to:")
            with Horizontal():
                for letter, name in (
                    ("q", "Queen"),
                    ("r", "Rook"),
                    ("b", "Bishop"),
                    ("n", "Knight"),
                ):
                    yield Button(f"{name} ({letter})", id=f"promote-{letter}")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        self.dismiss(str(event.button.id).removeprefix("promote-"))

    def action_choose(self, letter: str) -> None:
        self.dismiss(letter or None)


@dataclass
class _State:
    board: chess.Board = field(default_factory=chess.Board)
    white_bottom: bool = True
    interactive: bool = False
    last_move: tuple[chess.Square, chess.Square] | None = None
    cursor: chess.Square = chess.E2
    selected: chess.Square | None = None


class ChessBoard(Widget, can_focus=True):
    DEFAULT_CSS = """
    ChessBoard { width: 1fr; height: 1fr; }
    """
    BINDINGS: ClassVar[list[BindingType]] = [
        Binding("up", "cursor('up')", "Cursor", show=False),
        Binding("down", "cursor('down')", "Cursor", show=False),
        Binding("left", "cursor('left')", "Cursor", show=False),
        Binding("right", "cursor('right')", "Cursor", show=False),
        Binding("enter,space", "activate", "Select / move"),
        Binding("escape", "deselect", "Deselect", show=False),
    ]

    class Moved(Message):
        """The human played `uci` on the board."""

        def __init__(self, uci: str) -> None:
            super().__init__()
            self.uci = uci

    class Typed(Message):
        """A printable key the board doesn't use: it belongs to the notation input."""

        def __init__(self, character: str) -> None:
            super().__init__()
            self.character = character

    def __init__(self, *, id: str | None = None) -> None:
        super().__init__(id=id)
        self.state = _State()
        self._lines: list[Line] = []

    # ---- state --------------------------------------------------------------------------------

    def show(
        self,
        board: chess.Board,
        *,
        white_bottom: bool,
        last_move: str | None,
        interactive: bool,
    ) -> None:
        state = self.state
        if board.fen() != state.board.fen() or not interactive:
            state.selected = None
        state.board, state.white_bottom, state.interactive = board, white_bottom, interactive
        move = chess.Move.from_uci(last_move) if last_move else None
        state.last_move = (move.from_square, move.to_square) if move else None
        self._redraw()

    @property
    def geometry(self) -> Geometry:
        return geometry(self.size.width, self.size.height, white_bottom=self.state.white_bottom)

    def targets(self) -> frozenset[chess.Square]:
        selected = self.state.selected
        if selected is None:
            return frozenset()
        return frozenset(
            m.to_square for m in self.state.board.legal_moves if m.from_square == selected
        )

    def marks(self) -> Marks:
        board = self.state.board
        return Marks(
            cursor=self.state.cursor if self.has_focus else None,
            selected=self.state.selected,
            targets=self.targets(),
            last_move=self.state.last_move,
            check=board.king(board.turn) if board.is_check() else None,
        )

    # ---- drawing ------------------------------------------------------------------------------

    def _redraw(self) -> None:
        colors = palette(self.app.theme_variables)
        self._lines = draw(self.state.board, self.geometry, self.marks(), colors)
        self.refresh()

    def on_mount(self) -> None:
        self.app.theme_changed_signal.subscribe(self, lambda _theme: self._redraw())

    def on_resize(self, event: events.Resize) -> None:
        self._redraw()

    def on_focus(self, event: events.Focus) -> None:
        self._redraw()

    def on_blur(self, event: events.Blur) -> None:
        self._redraw()

    def render_line(self, y: int) -> Strip:
        # Never an unstyled cell: Textual's NO_COLOR filter dereferences every segment's style.
        # The widget's style goes under every cell, so the margins take the theme's background.
        width, base = self.size.width, self.rich_style
        if y >= len(self._lines):
            return Strip.blank(width, base)
        segments = Segment.apply_style(self._lines[y], style=base)
        return Strip(segments).crop_extend(0, width, base)

    # ---- input --------------------------------------------------------------------------------

    def action_cursor(self, key: str) -> None:
        self.state.cursor = arrow(self.state.cursor, key, white_bottom=self.state.white_bottom)
        self._redraw()

    def action_deselect(self) -> None:
        self.state.selected = None
        self._redraw()

    def action_activate(self) -> None:
        self.activate(self.state.cursor)

    def on_click(self, event: events.Click) -> None:
        self.focus()
        offset = event.get_content_offset(self)
        square = self.geometry.square_at(offset.x, offset.y) if offset is not None else None
        if square is not None:
            self.state.cursor = square
            self.activate(square)

    def on_key(self, event: events.Key) -> None:
        if event.character in NOTATION:
            event.stop()
            self.post_message(self.Typed(event.character))

    def activate(self, square: chess.Square) -> None:
        """Select a piece of the side to move, or move the selected piece here."""
        state = self.state
        if not state.interactive:
            self.app.bell()
            return
        board = state.board
        if state.selected is not None and square in self.targets():
            self._play(chess.Move(state.selected, square))
            return
        piece = board.piece_at(square)
        own = piece is not None and piece.color == board.turn
        state.selected = square if own and square != state.selected else None
        self._redraw()

    def _play(self, move: chess.Move) -> None:
        board = self.state.board
        promotions = [m for m in board.legal_moves if m.from_square == move.from_square]
        promotions = [m for m in promotions if m.to_square == move.to_square and m.promotion]
        self.state.selected = None
        self._redraw()
        if not promotions:
            self.post_message(self.Moved(move.uci()))
            return

        def promote(letter: str | None) -> None:
            if letter:
                self.post_message(self.Moved(move.uci() + letter))

        self.app.push_screen(PromotionScreen(), promote)
