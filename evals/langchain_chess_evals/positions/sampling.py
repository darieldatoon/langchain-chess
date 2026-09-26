"""Which Lichess games and positions go into the dataset, and in which split. Pure.

Games are read in file order; a seeded `random.Random` picks plies within each game and deals
each bucket's positions between the splits, so a month and a seed always give the same sample.
"""

import io
import random
import re
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass, field
from typing import Literal

import chess
import chess.pgn

from langchain_chess.state import JSONValue

type Band = Literal["<1200", "1200-1599", "1600-1999", "2000-2399", "2400+"]
type Phase = Literal["opening", "middlegame", "endgame"]
type Split = Literal["dev", "full"]
type TimeClass = Literal["ultrabullet", "bullet", "blitz", "rapid", "classical", "correspondence"]
type Bucket = tuple[Band, Phase]

BANDS: tuple[Band, ...] = ("<1200", "1200-1599", "1600-1999", "2000-2399", "2400+")
PHASES: tuple[Phase, ...] = ("opening", "middlegame", "endgame")
SPLITS: tuple[Split, ...] = ("dev", "full")

_BAND_FLOORS: tuple[tuple[int, Band], ...] = (
    (2400, "2400+"),
    (2000, "2000-2399"),
    (1600, "1600-1999"),
    (1200, "1200-1599"),
)
# Lichess's own classes: base seconds plus 40 moves of increment (lila `chess/Speed.scala`).
_SPEED_CEILINGS: tuple[tuple[int, TimeClass], ...] = (
    (30, "ultrabullet"),
    (180, "bullet"),
    (480, "blitz"),
    (1500, "rapid"),
)
_HEADER = re.compile(r'^\[(\w+) "(.*)"\]\s*$')


def band(rating: int) -> Band:
    return next((name for floor, name in _BAND_FLOORS if rating >= floor), "<1200")


def time_class(time_control: str) -> TimeClass:
    if time_control == "-":
        return "correspondence"
    base, _, increment = time_control.partition("+")
    estimate = int(base) + 40 * int(increment or 0)
    return next((name for ceiling, name in _SPEED_CEILINGS if estimate < ceiling), "classical")


def phase(board: chess.Board) -> Phase:
    """lila's `Divider` thresholds, applied to one position rather than a whole game."""
    majors_and_minors = chess.popcount(board.occupied & ~board.pawns & ~board.kings)
    if majors_and_minors <= 6:
        return "endgame"
    backrank_sparse = (
        chess.popcount(board.occupied_co[chess.WHITE] & chess.BB_RANK_1) < 4
        or chess.popcount(board.occupied_co[chess.BLACK] & chess.BB_RANK_8) < 4
    )
    if majors_and_minors <= 10 or backrank_sparse:
        return "middlegame"
    return "opening"


def split_games(lines: Iterable[str]) -> Iterator[str]:
    """One PGN text per game. A game starts at an `[Event` line that follows movetext."""
    buffer: list[str] = []
    in_movetext = False
    for line in lines:
        if line.startswith("[Event ") and in_movetext:
            yield "".join(buffer)
            buffer, in_movetext = [], False
        buffer.append(line)
        if line.strip() and not line.startswith("["):
            in_movetext = True
    if in_movetext:
        yield "".join(buffer)


def headers(text: str) -> dict[str, str]:
    """The tag pairs, read without parsing the moves."""
    found: dict[str, str] = {}
    for line in text.splitlines():
        if not line.startswith("["):
            break
        if match := _HEADER.match(line):
            found[match[1]] = match[2]
    return found


@dataclass(frozen=True, slots=True)
class Filters:
    time_classes: tuple[TimeClass, ...] = ("rapid", "classical")
    min_game_plies: int = 20
    first_ply: int = 10
    """Positions come from this ply onward: that many moves have been played."""
    per_game: int = 2
    min_legal: int = 2

    def json(self) -> dict[str, JSONValue]:
        return {
            "rated": True,
            "variant": "standard",
            "time_classes": list(self.time_classes),
            "exclude_terminations": ["Abandoned"],
            "min_game_plies": self.min_game_plies,
            "first_ply": self.first_ply,
            "per_game": self.per_game,
            "min_legal": self.min_legal,
            "dedupe": "FEN without the move counters",
            "band_by": "rating of the side to move",
            "phase_by": "lila Divider thresholds on the position",
        }


def _ratings(tags: Mapping[str, str]) -> tuple[int, int] | None:
    white, black = tags.get("WhiteElo", ""), tags.get("BlackElo", "")
    if not (white.isdigit() and black.isdigit()):
        return None
    return int(white), int(black)


def eligible(tags: Mapping[str, str], filters: Filters) -> bool:
    return (
        tags.get("Event", "").startswith("Rated ")
        and tags.get("Variant", "Standard") == "Standard"
        and "FEN" not in tags
        and tags.get("Termination") != "Abandoned"
        and _ratings(tags) is not None
        and time_class(tags.get("TimeControl", "-")) in filters.time_classes
    )


@dataclass(frozen=True, slots=True)
class Game:
    id: str
    month: str
    white_elo: int
    black_elo: int
    time_control: str
    time_class: TimeClass
    moves: tuple[str, ...]
    """UCI, from the standard start."""

    @property
    def url(self) -> str:
        return f"https://lichess.org/{self.id}"


def parse_game(text: str, month: str) -> Game | None:
    """None if the moves don't parse. Call only for `eligible` games."""
    tags = headers(text)
    ratings = _ratings(tags)
    assert ratings is not None
    game = chess.pgn.read_game(io.StringIO(text))
    if game is None or game.errors:
        return None
    return Game(
        id=tags.get("Site", "").rsplit("/", 1)[-1],
        month=month,
        white_elo=ratings[0],
        black_elo=ratings[1],
        time_control=tags["TimeControl"],
        time_class=time_class(tags["TimeControl"]),
        moves=tuple(move.uci() for move in game.mainline_moves()),
    )


@dataclass(frozen=True, slots=True)
class Position:
    game: Game
    ply: int
    fen: str
    legal: tuple[str, ...]
    band: Band
    phase: Phase

    @property
    def id(self) -> str:
        return f"{self.game.id}-{self.ply:03d}"

    @property
    def moves(self) -> tuple[str, ...]:
        return self.game.moves[: self.ply]

    @property
    def played(self) -> str:
        return self.game.moves[self.ply]

    @property
    def white_to_move(self) -> bool:
        return self.ply % 2 == 0

    @property
    def rating(self) -> int:
        """The side to move's: the player who played `played`."""
        return self.game.white_elo if self.white_to_move else self.game.black_elo


@dataclass(frozen=True, slots=True)
class Quotas:
    per_band: Mapping[Split, int] = field(default_factory=lambda: {"dev": 40, "full": 400})
    """Positions per rating band in each split, dealt evenly across phases."""

    def split_quota(self, split: Split, phase_: Phase) -> int:
        base, spare = divmod(self.per_band[split], len(PHASES))
        return base + (1 if PHASES.index(phase_) < spare else 0)

    def bucket(self, phase_: Phase) -> int:
        return sum(self.split_quota(split, phase_) for split in SPLITS)

    def json(self) -> dict[str, JSONValue]:
        return {split: self.per_band[split] for split in SPLITS}


@dataclass(frozen=True, slots=True)
class Sampled:
    position: Position
    split: Split


@dataclass(frozen=True, slots=True)
class Sample:
    positions: tuple[Sampled, ...]
    """Ordered by split, band, phase, then id."""
    months: tuple[str, ...]
    """Every month read, in order."""
    games_read: int
    games_used: int
    short: Mapping[Bucket, int]
    """Buckets that did not fill, and by how many positions."""


def _board_key(fen: str) -> str:
    return " ".join(fen.split()[:4])


def _game_positions(game: Game, filters: Filters) -> dict[int, chess.Board]:
    board = chess.Board()
    boards: dict[int, chess.Board] = {}
    for ply, uci in enumerate(game.moves):
        if ply >= filters.first_ply:
            boards[ply] = board.copy(stack=False)
        board.push_uci(uci)
    return boards


def sample(
    games: Iterable[tuple[str, str]],
    *,
    quotas: Quotas,
    filters: Filters,
    seed: int,
) -> Sample:
    """`games` yields `(month, pgn_text)`; reading stops once every bucket is full."""
    rng = random.Random(seed)
    room: dict[Bucket, int] = {(b, p): quotas.bucket(p) for b in BANDS for p in PHASES}
    taken: dict[Bucket, list[Position]] = {key: [] for key in room}
    seen: set[str] = set()
    months: list[str] = []
    games_read = games_used = 0
    for month, text in games:
        if not any(room.values()):
            break
        if not months or months[-1] != month:
            months.append(month)
        games_read += 1
        tags = headers(text)
        if not eligible(tags, filters):
            continue
        ratings = _ratings(tags)
        assert ratings is not None
        open_bands = {b for (b, _), left in room.items() if left}
        if not open_bands & {band(r) for r in ratings}:
            continue
        game = parse_game(text, month)
        if game is None or len(game.moves) < filters.min_game_plies:
            continue
        boards = _game_positions(game, filters)
        plies = sorted(boards)
        rng.shuffle(plies)
        kept = 0
        for ply in plies:
            if kept == filters.per_game:
                break
            board = boards[ply]
            fen = board.fen()
            legal = tuple(m.uci() for m in board.legal_moves)
            key = _board_key(fen)
            if len(legal) < filters.min_legal or key in seen:
                continue
            rating = game.white_elo if board.turn == chess.WHITE else game.black_elo
            bucket = (band(rating), phase(board))
            if not room[bucket]:
                continue
            seen.add(key)
            room[bucket] -= 1
            taken[bucket].append(Position(game, ply, fen, legal, *bucket))
            kept += 1
        games_used += kept > 0
    return Sample(
        positions=deal(taken, quotas, rng),
        months=tuple(months),
        games_read=games_read,
        games_used=games_used,
        short={key: left for key, left in room.items() if left},
    )


def deal(
    taken: Mapping[Bucket, list[Position]], quotas: Quotas, rng: random.Random
) -> tuple[Sampled, ...]:
    """Shuffle each bucket and fill `dev` first, so a short bucket shorts `full`."""
    dealt: list[Sampled] = []
    for (_, phase_), positions in taken.items():
        pool = sorted(positions, key=lambda p: p.id)
        rng.shuffle(pool)
        cut = quotas.split_quota("dev", phase_)
        dealt += [Sampled(p, "dev") for p in pool[:cut]]
        dealt += [Sampled(p, "full") for p in pool[cut:]]
    return tuple(
        sorted(
            dealt,
            key=lambda s: (
                SPLITS.index(s.split),
                BANDS.index(s.position.band),
                PHASES.index(s.position.phase),
                s.position.id,
            ),
        )
    )


def counts(positions: Iterable[Sampled]) -> dict[str, dict[str, dict[str, int]]]:
    """Split, then band, then phase."""
    table: dict[str, dict[str, dict[str, int]]] = {
        s: {b: dict.fromkeys(PHASES, 0) for b in BANDS} for s in SPLITS
    }
    for s in positions:
        table[s.split][s.position.band][s.position.phase] += 1
    return table
