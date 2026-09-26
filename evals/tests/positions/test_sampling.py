from pathlib import Path

import chess
import pytest

from langchain_chess_evals.positions.sampling import (
    BANDS,
    PHASES,
    Filters,
    Quotas,
    band,
    counts,
    eligible,
    headers,
    parse_game,
    phase,
    sample,
    split_games,
    time_class,
)

FIXTURE = Path(__file__).parents[1] / "fixtures" / "games.pgn"
TAGS = {
    "Event": "Rated Rapid game",
    "Site": "https://lichess.org/abcdefgh",
    "WhiteElo": "1500",
    "BlackElo": "1600",
    "TimeControl": "600+0",
    "Termination": "Normal",
}


def fixture_games() -> list[str]:
    return list(split_games(FIXTURE.read_text().splitlines(keepends=True)))


def pgn(tags: dict[str, str], movetext: str) -> str:
    return "".join(f'[{k} "{v}"]\n' for k, v in tags.items()) + f"\n{movetext}\n\n"


@pytest.mark.parametrize(
    ("rating", "expected"),
    [(0, "<1200"), (1199, "<1200"), (1200, "1200-1599"), (1999, "1600-1999"), (2400, "2400+")],
)
def test_band(rating, expected):
    assert band(rating) == expected


@pytest.mark.parametrize(
    ("control", "expected"),
    [
        ("-", "correspondence"),
        ("15+0", "ultrabullet"),
        ("60+1", "bullet"),
        ("180+2", "blitz"),
        ("600+0", "rapid"),
        ("900+15", "classical"),
        ("1800+0", "classical"),
    ],
)
def test_time_class(control, expected):
    assert time_class(control) == expected


def test_phase():
    assert phase(chess.Board()) == "opening"
    assert phase(chess.Board("4k3/8/8/8/8/8/8/R3K2R w - - 0 1")) == "endgame"
    # 10 majors and minors: the queens and a pair of bishops are gone
    assert phase(chess.Board("rn2k1nr/pppppppp/8/8/8/8/PPPPPPPP/RN2K1NR w - - 0 1")) == (
        "middlegame"
    )
    # every piece still on, but White's back rank has emptied
    assert phase(chess.Board("rnbqkbnr/pppppppp/8/8/2BQ1B2/2N2N2/PPPPPPPP/R3K2R w - - 0 1")) == (
        "middlegame"
    )


def test_split_games_reads_each_game_whole():
    games = fixture_games()
    assert len(games) == 13
    assert all(g.startswith("[Event ") for g in games)
    assert all(g.count("[Event ") == 1 for g in games)
    assert list(split_games([])) == []
    assert list(split_games(['[Event "x"]\n', "\n"])) == []


def test_headers_stop_at_the_movetext():
    text = pgn(TAGS, '1. e4 e5 {[Event "not a tag"]} 1-0')
    assert headers(text) == TAGS
    assert headers('[Bad tag]\n[Event "x"]\n') == {"Event": "x"}


@pytest.mark.parametrize(
    ("change", "expected"),
    [
        ({}, True),
        ({"TimeControl": "1800+0"}, True),
        ({"Event": "Casual Rapid game"}, False),
        ({"TimeControl": "180+0"}, False),
        ({"Termination": "Abandoned"}, False),
        ({"WhiteElo": "?"}, False),
        ({"Variant": "Chess960"}, False),
        ({"FEN": chess.STARTING_FEN}, False),
    ],
)
def test_eligible(change, expected):
    assert eligible({**TAGS, **change}, Filters()) is expected


def test_parse_game():
    game = parse_game(pgn(TAGS, "1. e4 e5 2. Nf3 1-0"), "2018-06")
    assert game is not None
    assert game.id == "abcdefgh"
    assert game.url == "https://lichess.org/abcdefgh"
    assert game.moves == ("e2e4", "e7e5", "g1f3")
    assert (game.white_elo, game.black_elo, game.time_class) == (1500, 1600, "rapid")
    assert parse_game(pgn(TAGS, "1. e4 e4 1-0"), "2018-06") is None


def test_quotas_deal_each_band_across_phases():
    quotas = Quotas()
    assert [quotas.split_quota("full", p) for p in PHASES] == [134, 133, 133]
    assert [quotas.split_quota("dev", p) for p in PHASES] == [14, 13, 13]
    assert [quotas.bucket(p) for p in PHASES] == [148, 146, 146]
    assert quotas.json() == {"dev": 40, "full": 400}


def small(dev: int = 3, full: int = 6) -> Quotas:
    """One dev and two full positions per band and phase: more than the fixture holds."""
    return Quotas({"dev": dev, "full": full})


def monthly(month: str = "2018-06") -> list[tuple[str, str]]:
    return [(month, g) for g in fixture_games()]


def test_sample_is_reproducible_from_its_seed():
    first = sample(monthly(), quotas=small(), filters=Filters(), seed=7)
    again = sample(monthly(), quotas=small(), filters=Filters(), seed=7)
    other = sample(monthly(), quotas=small(), filters=Filters(), seed=8)
    assert first == again
    assert [s.position.id for s in first.positions] != [s.position.id for s in other.positions]


def test_sample_keeps_only_eligible_positions():
    filters = Filters()
    drawn = sample(monthly(), quotas=small(), filters=filters, seed=7)
    assert drawn.months == ("2018-06",)
    assert drawn.games_read == 13
    assert 0 < drawn.games_used <= 10
    per_game: dict[str, int] = {}
    keys = set()
    for s in drawn.positions:
        p = s.position
        per_game[p.game.id] = per_game.get(p.game.id, 0) + 1
        board = chess.Board(p.fen)
        assert p.ply >= filters.first_ply
        assert len(p.legal) >= 2
        assert p.band == band(p.rating)
        assert p.phase == phase(board)
        assert p.moves == p.game.moves[: p.ply]
        assert p.played == p.game.moves[p.ply]
        assert p.rating == (p.game.white_elo if board.turn == chess.WHITE else p.game.black_elo)
        assert p.white_to_move is (board.turn == chess.WHITE)
        keys.add(" ".join(p.fen.split()[:4]))
    assert max(per_game.values()) <= filters.per_game
    assert len(keys) == len(drawn.positions)


def test_sample_orders_rows_and_reports_short_buckets():
    drawn = sample(monthly(), quotas=small(), filters=Filters(), seed=7)
    order = [
        (s.split, BANDS.index(s.position.band), PHASES.index(s.position.phase))
        for s in drawn.positions
    ]
    assert order == sorted(order, key=lambda o: (o[0] != "dev", o[1], o[2]))
    table = counts(drawn.positions)
    for (b, p), missing in drawn.short.items():
        assert table["dev"][b][p] + table["full"][b][p] == 3 - missing
        # a short bucket shorts full, never dev, unless it's empty
        assert table["dev"][b][p] == min(1, 3 - missing)


def test_sample_stops_once_every_bucket_is_full():
    drawn = sample(monthly(), quotas=Quotas({"dev": 0, "full": 0}), filters=Filters(), seed=1)
    assert drawn.games_read == 0
    assert drawn.positions == ()
    assert drawn.short == {}


def test_sample_records_every_month_it_reads():
    drawn = sample(
        monthly("2018-06") + monthly("2018-07"), quotas=small(), filters=Filters(), seed=7
    )
    assert drawn.months == ("2018-06", "2018-07")
    assert {s.position.game.month for s in drawn.positions} == {"2018-06", "2018-07"}


def test_filters_json():
    assert Filters().json()["time_classes"] == ["rapid", "classical"]
