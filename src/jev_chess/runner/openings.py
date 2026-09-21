"""A small opening book so near-deterministic players do not replay one game.

Lines are mainstream and roughly balanced, 4 to 8 plies, given in SAN and converted to UCI
against a fresh board so a typo fails loudly at import time rather than mid-tournament.
"""

import random
from collections.abc import Sequence
from dataclasses import dataclass

import chess


@dataclass(frozen=True, slots=True)
class Opening:
    name: str
    san: tuple[str, ...]
    uci: tuple[str, ...]


def _opening(name: str, line: str) -> Opening:
    board = chess.Board()
    san = tuple(line.split())
    uci: list[str] = []
    for token in san:
        move = board.parse_san(token)
        uci.append(move.uci())
        board.push(move)
    return Opening(name=name, san=san, uci=tuple(uci))


BOOK: tuple[Opening, ...] = tuple(
    _opening(name, line)
    for name, line in (
        ("Italian Game", "e4 e5 Nf3 Nc6 Bc4 Bc5"),
        ("Two Knights", "e4 e5 Nf3 Nc6 Bc4 Nf6"),
        ("Ruy Lopez", "e4 e5 Nf3 Nc6 Bb5 a6"),
        ("Berlin", "e4 e5 Nf3 Nc6 Bb5 Nf6"),
        ("Scotch", "e4 e5 Nf3 Nc6 d4 exd4"),
        ("Petroff", "e4 e5 Nf3 Nf6"),
        ("Philidor", "e4 e5 Nf3 d6 d4"),
        ("Sicilian Najdorf", "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6"),
        ("Sicilian Dragon", "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6"),
        ("Sicilian Sveshnikov", "e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5"),
        ("Sicilian Taimanov", "e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6"),
        ("Sicilian Alapin", "e4 c5 c3 d5 exd5 Qxd5"),
        ("French Winawer", "e4 e6 d4 d5 Nc3 Bb4"),
        ("French Tarrasch", "e4 e6 d4 d5 Nd2 Nf6"),
        ("Caro-Kann Classical", "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5"),
        ("Caro-Kann Advance", "e4 c6 d4 d5 e5 Bf5"),
        ("Scandinavian", "e4 d5 exd5 Qxd5 Nc3 Qa5"),
        ("Pirc", "e4 d6 d4 Nf6 Nc3 g6"),
        ("Queen's Gambit Declined", "d4 d5 c4 e6 Nc3 Nf6"),
        ("Queen's Gambit Accepted", "d4 d5 c4 dxc4 Nf3 Nf6"),
        ("Slav", "d4 d5 c4 c6 Nf3 Nf6"),
        ("Nimzo-Indian", "d4 Nf6 c4 e6 Nc3 Bb4"),
        ("Queen's Indian", "d4 Nf6 c4 e6 Nf3 b6"),
        ("King's Indian", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6"),
        ("Grunfeld", "d4 Nf6 c4 g6 Nc3 d5"),
        ("London System", "d4 d5 Nf3 Nf6 Bf4 e6"),
        ("Catalan", "d4 Nf6 c4 e6 g3 d5 Bg2"),
        ("English Symmetrical", "c4 c5 Nc3 Nc6 g3 g6"),
        ("English Reversed Sicilian", "c4 e5 Nc3 Nf6 Nf3 Nc6"),
        ("Reti", "Nf3 d5 c4 e6 g3 Nf6"),
        ("Dutch Leningrad", "d4 f5 g3 Nf6 Bg2 g6"),
        ("Alekhine", "e4 Nf6 e5 Nd5 d4 d6"),
    )
)


def pick_openings(rng: random.Random, n: int) -> list[Opening]:
    """Cycle through a shuffled book so `n` games cover it evenly before repeating."""
    order = list(BOOK)
    rng.shuffle(order)
    return [order[i % len(order)] for i in range(n)]


def board_after(opening: Sequence[str]) -> chess.Board:
    board = chess.Board()
    for uci in opening:
        board.push_uci(uci)
    return board
