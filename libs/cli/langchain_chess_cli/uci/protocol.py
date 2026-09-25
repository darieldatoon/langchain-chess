"""UCI command parsing. Pure: a line in, a typed command out."""

from dataclasses import dataclass, field

import chess

STARTPOS = chess.STARTING_FEN


@dataclass(frozen=True, slots=True)
class Uci:
    pass


@dataclass(frozen=True, slots=True)
class IsReady:
    pass


@dataclass(frozen=True, slots=True)
class SetOption:
    name: str
    value: str | None


@dataclass(frozen=True, slots=True)
class UciNewGame:
    pass


@dataclass(frozen=True, slots=True)
class Position:
    start_fen: str = STARTPOS
    moves: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class Go:
    movetime: int | None = None
    wtime: int | None = None
    btime: int | None = None
    winc: int = 0
    binc: int = 0
    movestogo: int | None = None
    infinite: bool = False
    ponder: bool = False
    searchmoves: tuple[str, ...] | None = None


@dataclass(frozen=True, slots=True)
class Stop:
    pass


@dataclass(frozen=True, slots=True)
class PonderHit:
    pass


@dataclass(frozen=True, slots=True)
class Quit:
    pass


@dataclass(frozen=True, slots=True)
class Unknown:
    line: str = field(default="")


type Command = (
    Uci | IsReady | SetOption | UciNewGame | Position | Go | Stop | PonderHit | Quit | Unknown
)

_SIMPLE: dict[str, Command] = {
    "uci": Uci(),
    "isready": IsReady(),
    "ucinewgame": UciNewGame(),
    "stop": Stop(),
    "ponderhit": PonderHit(),
    "quit": Quit(),
}
_GO_INTS = ("movetime", "wtime", "btime", "winc", "binc", "movestogo")
_GO_KEYWORDS = frozenset({*_GO_INTS, "infinite", "ponder", "searchmoves", "depth", "nodes", "mate"})


def _setoption(tokens: list[str]) -> Command:
    if not tokens or tokens[0] != "name":
        return Unknown(" ".join(["setoption", *tokens]))
    rest = tokens[1:]
    if "value" in rest:
        at = rest.index("value")
        return SetOption(" ".join(rest[:at]), " ".join(rest[at + 1 :]))
    return SetOption(" ".join(rest), None)


def _position(tokens: list[str]) -> Command:
    if not tokens:
        return Unknown("position")
    moves_at = tokens.index("moves") if "moves" in tokens else len(tokens)
    head, moves = tokens[:moves_at], tuple(tokens[moves_at + 1 :])
    if head == ["startpos"]:
        return Position(STARTPOS, moves)
    if head and head[0] == "fen" and len(head) > 1:
        return Position(" ".join(head[1:]), moves)
    return Unknown(" ".join(["position", *tokens]))


def _int(token: str) -> int | None:
    try:
        return int(token)
    except ValueError:
        return None


def _go(tokens: list[str]) -> Command:
    values: dict[str, int] = {}
    flags = {"infinite": False, "ponder": False}
    searchmoves: list[str] | None = None
    index = 0
    while index < len(tokens):
        token = tokens[index]
        if token in flags:
            flags[token] = True
        elif token == "searchmoves":
            searchmoves = []
            while index + 1 < len(tokens) and tokens[index + 1] not in _GO_KEYWORDS:
                index += 1
                searchmoves.append(tokens[index])
        elif token in _GO_KEYWORDS and index + 1 < len(tokens):
            index += 1
            if token in _GO_INTS and (number := _int(tokens[index])) is not None:
                values[token] = number
        index += 1
    return Go(
        movetime=values.get("movetime"),
        wtime=values.get("wtime"),
        btime=values.get("btime"),
        winc=values.get("winc", 0),
        binc=values.get("binc", 0),
        movestogo=values.get("movestogo"),
        infinite=flags["infinite"],
        ponder=flags["ponder"],
        searchmoves=tuple(searchmoves) if searchmoves is not None else None,
    )


def parse(line: str) -> Command:
    tokens = line.split()
    if not tokens:
        return Unknown(line)
    head, rest = tokens[0], tokens[1:]
    if head in _SIMPLE and not rest:
        return _SIMPLE[head]
    if head == "setoption":
        return _setoption(rest)
    if head == "position":
        return _position(rest)
    if head == "go":
        return _go(rest)
    return Unknown(line)
