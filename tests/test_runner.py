import random
from pathlib import Path

import chess
import pytest

from jev_chess.engines import EloLimit, MaiaOpponent, SkillLimit, StockfishOpponent
from jev_chess.policies import (
    HybridConfig,
    HybridPolicy,
    JevPolicy,
    LLMConfig,
    LLMPolicy,
    MoveDecision,
)
from jev_chess.runner import (
    BOOK,
    EnginePlayer,
    HybridPlayer,
    HybridSpec,
    JevPlayer,
    JevSpec,
    LLMPlayer,
    LLMSpec,
    MaiaSpec,
    RandomPlayer,
    RandomSpec,
    Roster,
    SpecError,
    StockfishSpec,
    board_after,
    build_player,
    parse_spec,
    pick_openings,
    play_game,
)
from jev_chess.runner import players as players_module
from jev_chess.settings import EngineSettings, GatewaySettings
from tests.fake_jev import FakeClassifier, choice_response
from tests.fake_llm import FakeChatModel, reply
from tests.fakes import FakeBackend

GATEWAY = GatewaySettings(
    _env_file=None,
    LANGSMITH_GATEWAY=True,
    LANGSMITH_GATEWAY_API_KEY="lsv2_x",
    TYPESAFE_API_KEY="lsv2_x",
    TYPESAFE_BASE_URL="https://gateway.smith.langchain.com/typesafe",
)


# --- openings -----------------------------------------------------------------------------


def test_book_lines_are_legal_and_varied() -> None:
    assert len(BOOK) >= 30
    for opening in BOOK:
        board = board_after(opening.uci)
        assert len(board.move_stack) == len(opening.san)
        assert board.is_valid()
    assert len({o.name for o in BOOK}) == len(BOOK)


def test_pick_openings_cycles_a_shuffled_book() -> None:
    picks = pick_openings(random.Random(3), len(BOOK) + 2)
    assert len({o.name for o in picks[: len(BOOK)]}) == len(BOOK)
    assert picks[len(BOOK)] == picks[0]


# --- game loop ----------------------------------------------------------------------------


class ScriptedPlayer:
    def __init__(self, name: str, moves: list[str]) -> None:
        self._name = name
        self._moves = iter(moves)

    @property
    def name(self) -> str:
        return self._name

    def decide(self, board: chess.Board, game_id: str, ply: int) -> MoveDecision:
        return MoveDecision(
            uci=next(self._moves), source="engine", model=self._name, latency_ms=1.0, cost_usd=0.0
        )


def test_play_game_scholars_mate_records_every_ply() -> None:
    white = ScriptedPlayer("w", ["e2e4", "f1c4", "d1h5", "h5f7"])
    black = ScriptedPlayer("b", ["e7e5", "b8c6", "g8f6"])
    plies = []
    record = play_game(white, black, "g1", on_ply=plies.append)
    assert record.result == "1-0"
    assert record.termination == "checkmate"
    assert record.plies == 7
    assert record.pgn.endswith("Qxf7#")
    assert [p.san for p in plies][-1] == "Qxf7#"
    assert plies[0].fen_before == chess.STARTING_FEN
    assert plies[0].side == "white"
    assert plies[1].player == "b"
    assert record.white_totals.plies == 4
    assert record.black_totals.plies == 3
    assert record.white_totals.latency_ms == 4.0


def test_play_game_from_opening_and_max_plies() -> None:
    white = RandomPlayer(1)
    black = RandomPlayer(2)
    opening = BOOK[0]
    record = play_game(
        white, black, "g2", opening.name, opening.uci, max_plies=len(opening.uci) + 6
    )
    assert record.opening == opening.name
    assert record.opening_plies == len(opening.uci)
    assert record.plies <= len(opening.uci) + 6
    if record.termination == "max_plies":
        assert record.result == "1/2-1/2"


def test_play_game_rejects_illegal_player_move() -> None:
    cheat = ScriptedPlayer("cheat", ["e2e5"])
    with pytest.raises(ValueError, match="illegal move"):
        play_game(cheat, RandomPlayer(0), "g3")


def test_side_totals_track_unknown_cost_and_fallbacks() -> None:
    from jev_chess.runner import SideTotals

    totals = SideTotals(player="p")
    totals.add(
        MoveDecision(
            uci="e2e4",
            source="fallback_random",
            model="m",
            latency_ms=1,
            cost_usd=None,
            escalated=True,
            illegal_attempts=2,
        )
    )
    totals.add(MoveDecision(uci="d2d4", source="llm", model="m", latency_ms=1, cost_usd=0.5))
    assert totals.cost_known is False
    assert totals.cost_usd == 0.5
    assert totals.fallbacks == 1
    assert totals.escalations == 1
    assert totals.illegal_attempts == 2


# --- specs --------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("random", RandomSpec()),
        ("jev", JevSpec()),
        ("jev:terse", JevSpec(style="terse")),
        ("maia:1500", MaiaSpec(rating=1500)),
        ("stockfish:1600", StockfishSpec(EloLimit(1600))),
        ("stockfish:skill:3", StockfishSpec(SkillLimit(3))),
        ("llm:claude-opus-5", LLMSpec("langsmith:anthropic/claude-opus-5")),
        ("llm:langsmith:openai/gpt-5.6-sol:low", LLMSpec("langsmith:openai/gpt-5.6-sol", "low")),
        ("llm:openai:gpt-5.6-sol:high:nolegal", LLMSpec("openai:gpt-5.6-sol", "high", False)),
        (
            "llm:anthropic:claude-opus-5:nolegal:low",
            LLMSpec("anthropic:claude-opus-5", "low", False),
        ),
    ],
)
def test_parse_spec(text: str, expected: object) -> None:
    spec = parse_spec(text)
    assert spec == expected
    assert isinstance(spec.name, str)


@pytest.mark.parametrize(
    "text",
    [
        "",
        "jev:loud",
        "jev:rich:extra",
        "maia:1250",
        "maia:abc",
        "stockfish:1000",
        "stockfish:skill:99",
        "stockfish:x:y:z",
        "llm",
        "llm:mystery-9000",
        "llm:nolegal",
        "random:1",
        "engine",
    ],
)
def test_parse_spec_rejects(text: str) -> None:
    with pytest.raises(SpecError):
        parse_spec(text)


def test_spec_names() -> None:
    assert parse_spec("stockfish:skill:3").name == "stockfish:skill:3"
    assert parse_spec("stockfish:1600").name == "stockfish:1600"
    assert (
        parse_spec("llm:openai:gpt-5.6-sol:nolegal").name == "llm:openai:gpt-5.6-sol:medium:nolegal"
    )
    assert parse_spec("llm:gpt-5.6-sol").name == "llm:langsmith:openai/gpt-5.6-sol:medium"
    assert parse_spec("jev:terse").name == "jev:terse"


# --- players ------------------------------------------------------------------------------


def test_engine_player_wraps_move_player() -> None:
    closed = []
    backend = FakeBackend(scripted_move=chess.Move.from_uci("e2e4"))
    engine = StockfishOpponent(backend, EloLimit(1500))
    player = EnginePlayer("stockfish:1500", engine, lambda: closed.append(True))
    decision = player.decide(chess.Board(), "g", 1)
    assert (decision.uci, decision.source, decision.cost_usd) == ("e2e4", "engine", 0.0)
    player.close()
    assert closed == [True]
    EnginePlayer("x", engine).close()


def test_jev_player_plays_top_move_with_telemetry() -> None:
    fake = FakeClassifier(
        scripted=choice_response({"e2e4": 0.7, "d2d4": 0.3}, confidence=0.8, model="jev-1.13.0")
    )
    player = JevPlayer(JevPolicy(fake), "jev")
    decision = player.decide(chess.Board(), "g", 1)
    assert decision.uci == "e2e4"
    assert decision.source == "jev"
    assert decision.jev_confidence == 0.8
    assert decision.jev_margin == pytest.approx(0.4)
    assert decision.jev_top_k is not None
    assert decision.cost_usd == pytest.approx(100 * 0.042 / 1_000_000)
    player.close()


def test_llm_player_delegates() -> None:
    player = LLMPlayer(LLMPolicy(FakeChatModel([reply("MOVE: e4")]), LLMConfig()), "llm:x")
    assert player.decide(chess.Board(), "g", 1).uci == "e2e4"
    player.close()
    assert RandomPlayer(0).decide(chess.Board(), "g", 1).source == "engine"
    RandomPlayer(0).close()


def test_build_player_and_roster(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    opened: list[str] = []

    class FakeEngine:
        def __init__(self, label: str) -> None:
            self.label = label

        def play(self, board: chess.Board) -> chess.Move:
            return next(iter(board.legal_moves))

        def close(self) -> None:
            opened.append(f"closed:{self.label}")

    monkeypatch.setattr(
        MaiaOpponent,
        "open",
        classmethod(lambda cls, rating, weights_dir, lc0_path: FakeEngine(f"maia{rating}")),
    )
    monkeypatch.setattr(
        StockfishOpponent, "open", classmethod(lambda cls, strength, path: FakeEngine("sf"))
    )
    monkeypatch.setattr(
        JevPolicy,
        "from_settings",
        classmethod(lambda cls, settings=None, config=None: JevPolicy(FakeClassifier(), config)),
    )
    monkeypatch.setattr(
        LLMPolicy,
        "from_settings",
        classmethod(
            lambda cls, settings=None, config=None: LLMPolicy(
                FakeChatModel([reply("MOVE: e4")]), config
            )
        ),
    )
    engines = EngineSettings(_env_file=None)

    assert isinstance(build_player(RandomSpec(), engines), RandomPlayer)
    assert build_player(MaiaSpec(1100), engines).name == "maia:1100"
    assert build_player(StockfishSpec(SkillLimit(1)), engines).name == "stockfish:skill:1"
    assert build_player(JevSpec(), engines, GATEWAY).name == "jev"
    llm = build_player(LLMSpec("openai:gpt-5.6-sol", "low"), engines, GATEWAY)
    assert llm.name == "llm:openai:gpt-5.6-sol:low"

    with Roster(MaiaSpec(1100), StockfishSpec(EloLimit(1400)), engines) as roster:
        assert roster.white is not None
        assert roster.black is not None
        record = play_game(roster.white, roster.black, "g", max_plies=4)
        assert record.plies == 4
    assert opened == ["closed:maia1100", "closed:sf"]


def test_run_config_carries_game_metadata() -> None:
    config = players_module._run_config("jev", "game-7", 12)
    assert config["metadata"] == {"game_id": "game-7", "ply": 12, "player": "jev"}
    assert "jev-chess" in config["tags"]


def test_roster_exit_tolerates_unopened_players() -> None:
    roster = Roster(RandomSpec(), RandomSpec(), EngineSettings(_env_file=None))
    roster.__exit__(None, None, None)
    assert roster.white is None


# --- hybrid specs -------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("hybrid:claude-opus-5", HybridSpec("langsmith:anthropic/claude-opus-5")),
        (
            "hybrid:openai:gpt-5.6-sol:low:k3:t0.7:confidence",
            HybridSpec("openai:gpt-5.6-sol", "low", 3, None, 0.7, "confidence"),
        ),
        (
            "hybrid:gpt-5.6-sol:p0.8:t0",
            HybridSpec("langsmith:openai/gpt-5.6-sol", top_p=0.8, threshold=0.0),
        ),
        ("hybrid:claude-opus-5:t1", HybridSpec("langsmith:anthropic/claude-opus-5", threshold=1.0)),
    ],
)
def test_parse_hybrid_spec(text: str, expected: HybridSpec) -> None:
    spec = parse_spec(text)
    assert spec == expected
    assert spec.name.startswith("hybrid:")


@pytest.mark.parametrize(
    "text",
    [
        "hybrid",
        "hybrid:t0.9",
        "hybrid:claude-opus-5:k0",
        "hybrid:claude-opus-5:t2",
        "hybrid:mystery-9000",
        "hybrid:claude-opus-5:p0",
    ],
)
def test_parse_hybrid_spec_rejects(text: str) -> None:
    with pytest.raises(SpecError):
        parse_spec(text)


def test_hybrid_spec_name_matches_config_label() -> None:
    spec = parse_spec("hybrid:claude-opus-5:low:k5:t0.9")
    assert spec.name == "hybrid:langsmith:anthropic/claude-opus-5:low:k5:t0.9:margin"


def test_build_hybrid_player(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        HybridPolicy,
        "from_settings",
        classmethod(
            lambda cls, settings=None, config=None: HybridPolicy(
                JevPolicy(FakeClassifier(scripted=choice_response({"e2e4": 0.9, "d2d4": 0.1}))),
                LLMPolicy(FakeChatModel([reply("MOVE: e4")]), (config or HybridConfig()).llm),
                config,
            )
        ),
    )
    player = build_player(
        HybridSpec("langsmith:anthropic/claude-opus-5", threshold=0.5),
        EngineSettings(_env_file=None),
        GATEWAY,
    )
    assert isinstance(player, HybridPlayer)
    decision = player.decide(chess.Board(), "g", 1)
    assert decision.source == "jev"
    assert decision.jev_top_uci == "e2e4"
    player.close()


def test_parse_hybrid_spec_non_numeric_suffix_stays_in_the_model_text() -> None:
    # `kx` is not a k<int> option, so it is treated as part of an explicit provider:model spec.
    spec = parse_spec("hybrid:claude-opus-5:kx")
    assert isinstance(spec, HybridSpec)
    assert spec.model == "claude-opus-5:kx"


def test_hybrid_player_close_is_a_noop() -> None:
    player = HybridPlayer(
        HybridPolicy(
            JevPolicy(FakeClassifier()),
            LLMPolicy(FakeChatModel([reply("MOVE: a3")]), LLMConfig()),
            HybridConfig(threshold=1.0),
        ),
        "hybrid:test",
    )
    assert player.name == "hybrid:test"
    assert player.close() is None
