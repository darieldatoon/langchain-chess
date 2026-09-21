"""Sample human-like positions from Maia self-play.

lc0 at one node is deterministic, so every game from the same start would be identical.
A seeded random opening of a few non-losing plies (judged by our own SEE facts) gives
diversity; Maia at mixed ratings then plays realistic human moves from there. Fully
offline and reproducible from the seed.
"""

import random
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass

import chess

from jev_chess.analysis.records import Phase, PositionRecord
from jev_chess.core import all_move_facts
from jev_chess.engines.protocol import MovePlayer

type PlayerFactory = Callable[[str], MovePlayer]


@dataclass(frozen=True, slots=True)
class SampleConfig:
    n: int = 2000
    per_game: int = 4
    min_ply: int = 10
    max_ply: int = 60
    opening_plies: tuple[int, int] = (4, 10)
    max_plies: int = 120
    ratings: tuple[str, ...] = ("1100", "1500", "1900")
    seed: int = 7


def phase_of(board: chess.Board) -> Phase:
    """Opening by move count, endgame by non-pawn material, middlegame otherwise."""
    if board.fullmove_number <= 10:
        return "opening"
    non_pawn = sum(
        len(board.pieces(pt, color))
        * {chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}[pt]
        for pt in (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN)
        for color in (chess.WHITE, chess.BLACK)
    )
    return "endgame" if non_pawn <= 26 else "middlegame"


class RandomOpener:
    """Plays a random legal move that does not lose material and is not a king move."""

    def __init__(self, rng: random.Random) -> None:
        self._rng = rng

    def play(self, board: chess.Board) -> chess.Move:
        facts = all_move_facts(board)
        sound = [f for f in facts if f.see_gain >= 0 and f.piece != "king"]
        pool = sound or list(facts)
        return chess.Move.from_uci(self._rng.choice(pool).uci)


def play_game(
    white: MovePlayer,
    black: MovePlayer,
    opener: MovePlayer,
    opening_plies: int,
    max_plies: int,
) -> list[chess.Board]:
    """Return a snapshot of the board after every ply, including the start position."""
    board = chess.Board()
    history = [board.copy(stack=False)]
    while not board.is_game_over(claim_draw=True) and len(board.move_stack) < max_plies:
        if len(board.move_stack) < opening_plies:
            player = opener
        else:
            player = white if board.turn == chess.WHITE else black
        board.push(player.play(board))
        history.append(board.copy(stack=False))
    return history


def pick_positions(
    boards: Sequence[chess.Board],
    rng: random.Random,
    config: SampleConfig,
    game_id: str,
    white: str,
    black: str,
) -> list[PositionRecord]:
    eligible = [
        ply
        for ply in range(config.min_ply, min(config.max_ply, len(boards) - 1) + 1)
        if not boards[ply].is_game_over(claim_draw=True)
    ]
    chosen = sorted(rng.sample(eligible, min(config.per_game, len(eligible))))
    return [
        PositionRecord(
            id=f"{game_id}-{ply:03d}",
            fen=boards[ply].fen(),
            ply=ply,
            phase=phase_of(boards[ply]),
            game_id=game_id,
            white=white,
            black=black,
        )
        for ply in chosen
    ]


def sample_positions(
    players: PlayerFactory, config: SampleConfig | None = None
) -> Iterator[PositionRecord]:
    """Yield positions until `config.n` have been produced. `players(rating)` must be cached."""
    config = config or SampleConfig()
    rng = random.Random(config.seed)
    opener = RandomOpener(rng)
    produced = 0
    game_index = 0
    while produced < config.n:
        white, black = rng.choice(config.ratings), rng.choice(config.ratings)
        opening = rng.randint(*config.opening_plies)
        boards = play_game(players(white), players(black), opener, opening, config.max_plies)
        game_id = f"g{game_index:04d}"
        game_index += 1
        for record in pick_positions(boards, rng, config, game_id, white, black):
            if produced >= config.n:
                return
            produced += 1
            yield record
