"""Phase 5: adjudication, concurrent matches with a budget, grading, Elo, report."""

from pathlib import Path

import chess
import pytest
from typer.testing import CliRunner

from jev_chess.analysis import (
    GradeRecord,
    anchor_rating,
    classify,
    expected,
    fit_elo,
    grade_one,
    grade_plies,
    pairings,
    pareto_rows,
    read_jsonl,
    summarise,
)
from jev_chess.cli import app
from jev_chess.engines import Oracle, OracleConfig
from jev_chess.policies import MoveDecision
from jev_chess.runner import (
    AdjudicationConfig,
    Adjudicator,
    Budget,
    GameRecord,
    Match,
    MatchConfig,
    PlyRecord,
    RandomPlayer,
    RandomSpec,
    Result,
    SideTotals,
    plan_games,
    play_game,
)
from jev_chess.settings import EngineSettings
from tests.fakes import FakeBackend, info

runner = CliRunner()


class ScriptedOracle:
    """Returns scripted white-POV centipawn evaluations in order, converting POV per board."""

    def __init__(self, cps: list[int]) -> None:
        self._cps = iter(cps)
        self.calls = 0
        self.closed = False

    def evaluate(self, board: chess.Board, multipv: int | None = None):
        from jev_chess.engines.stockfish import Evaluation, RankedMove

        self.calls += 1
        cp_white = next(self._cps)
        cp = cp_white if board.turn == chess.WHITE else -cp_white
        move = next(iter(board.legal_moves)).uci() if any(board.legal_moves) else "0000"
        return Evaluation((RankedMove(move, cp, None),))

    def close(self) -> None:
        self.closed = True

    def __enter__(self):
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


# --- adjudication -------------------------------------------------------------------------


def test_adjudicator_ends_after_consecutive_decisive_plies() -> None:
    oracle = ScriptedOracle([1200, 1300, 1100])
    adj = Adjudicator(oracle, AdjudicationConfig(decisive_cp=1000, decisive_plies=3, min_ply=0))
    board = chess.Board()
    assert adj.after_ply(board) is None
    assert adj.after_ply(board) is None
    assert adj.after_ply(board) == ("1-0", "adjudication_decisive")


def test_adjudicator_streak_resets_on_sign_change_and_respects_min_ply() -> None:
    oracle = ScriptedOracle([-1200, 500, -1200, -1200])
    adj = Adjudicator(oracle, AdjudicationConfig(decisive_cp=1000, decisive_plies=2, min_ply=0))
    board = chess.Board()
    assert adj.after_ply(board) is None  # streak 1 for black
    assert adj.after_ply(board) is None  # reset (not decisive)
    assert adj.after_ply(board) is None  # streak 1
    assert adj.after_ply(board) == ("0-1", "adjudication_decisive")
    quiet = ScriptedOracle([5000])
    early = Adjudicator(quiet, AdjudicationConfig(min_ply=10))
    assert early.after_ply(chess.Board()) is None
    assert quiet.calls == 0


def test_adjudicator_at_max_plies() -> None:
    assert Adjudicator(ScriptedOracle([350]), AdjudicationConfig()).at_max_plies(chess.Board()) == (
        "1-0",
        "adjudication_max_plies",
    )
    assert Adjudicator(ScriptedOracle([-350]), AdjudicationConfig()).at_max_plies(
        chess.Board()
    ) == ("0-1", "adjudication_max_plies")
    assert Adjudicator(ScriptedOracle([100]), AdjudicationConfig()).at_max_plies(chess.Board()) == (
        "1/2-1/2",
        "max_plies",
    )


def test_play_game_uses_adjudicator() -> None:
    class Always:
        def after_ply(self, board: chess.Board) -> tuple[str, str] | None:
            return ("0-1", "adjudication_decisive") if len(board.move_stack) >= 3 else None

        def at_max_plies(self, board: chess.Board) -> tuple[str, str]:
            return ("1-0", "adjudication_max_plies")

    record = play_game(RandomPlayer(1), RandomPlayer(2), "g", adjudicator=Always())
    assert (record.result, record.termination, record.plies) == ("0-1", "adjudication_decisive", 3)

    class Never:
        def after_ply(self, board: chess.Board) -> None:
            return None

        def at_max_plies(self, board: chess.Board) -> tuple[str, str]:
            return ("1-0", "adjudication_max_plies")

    capped = play_game(RandomPlayer(1), RandomPlayer(2), "g", max_plies=4, adjudicator=Never())
    assert (capped.result, capped.termination) == ("1-0", "adjudication_max_plies")


# --- match runner -------------------------------------------------------------------------


def test_plan_games_alternates_colours_and_ids() -> None:
    plans = plan_games(RandomSpec(), RandomSpec(), MatchConfig(games=4, seed=1), "lbl")
    assert [p.game_id for p in plans] == [f"lbl-1-{i:03d}" for i in range(4)]
    assert len({p.opening.name for p in plans}) == 4


def test_budget_tracks_and_exhausts() -> None:
    budget = Budget(max_usd=1.0)
    assert not budget.exhausted
    budget.add(0.6)
    budget.add(0.5)
    assert budget.exhausted
    assert not Budget(None).exhausted


def test_match_runs_concurrently_and_writes_records(tmp_path: Path) -> None:
    config = MatchConfig(games=6, max_plies=8, seed=3, workers=3, adjudicate=False)
    seen: list[str] = []
    match = Match(
        RandomSpec(),
        RandomSpec(),
        config,
        tmp_path,
        EngineSettings(_env_file=None),
        None,
        on_game=lambda g: seen.append(g.game_id),
    )
    played = match.run("rr")
    assert [g.game_id for g in played] == [f"rr-3-{i:03d}" for i in range(6)]
    assert sorted(seen) == [g.game_id for g in played]
    games = list(read_jsonl(tmp_path / "games.jsonl", GameRecord))
    plies = list(read_jsonl(tmp_path / "plies.jsonl", PlyRecord))
    assert len(games) == 6
    assert len(plies) == sum(g.plies - g.opening_plies for g in games)
    assert match.skipped == []


def test_match_adjudicates_with_injected_oracle(tmp_path: Path) -> None:
    oracles: list[ScriptedOracle] = []

    def open_oracle() -> ScriptedOracle:
        oracle = ScriptedOracle([2000] * 500)
        oracles.append(oracle)
        return oracle

    config = MatchConfig(
        games=1,
        max_plies=60,
        seed=1,
        workers=1,
        adjudicate=True,
        adjudication=AdjudicationConfig(min_ply=0, decisive_plies=2),
    )
    match = Match(
        RandomSpec(),
        RandomSpec(),
        config,
        tmp_path,
        EngineSettings(_env_file=None),
        None,
        open_oracle=open_oracle,
    )
    played = match.run("adj")
    assert played[0].termination == "adjudication_decisive"
    assert played[0].result == "1-0"
    assert oracles[0].closed


def test_match_budget_skips_remaining_games(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from jev_chess.runner import players as players_module

    class Pricey(RandomPlayer):
        def decide(self, board: chess.Board, game_id: str, ply: int) -> MoveDecision:
            d = super().decide(board, game_id, ply)
            return MoveDecision(
                uci=d.uci, source="llm", model="pricey", latency_ms=0.0, cost_usd=0.25
            )

    monkeypatch.setattr(players_module, "RandomPlayer", Pricey)
    config = MatchConfig(games=5, max_plies=12, seed=2, workers=1, adjudicate=False, max_usd=1.0)
    match = Match(
        RandomSpec(), RandomSpec(), config, tmp_path, EngineSettings(_env_file=None), None
    )
    played = match.run("cap")
    assert 1 <= len(played) < 5
    assert len(match.skipped) == 5 - len(played)
    assert match.budget.spent_usd >= 1.0


# --- grading ------------------------------------------------------------------------------


def ply(
    uci: str,
    fen: str = chess.STARTING_FEN,
    escalated: bool = False,
    jev_top: str | None = None,
    n: int = 1,
) -> PlyRecord:
    return PlyRecord(
        game_id="g",
        ply=n,
        side="white",
        player="p",
        fen_before=fen,
        uci=uci,
        san=uci,
        source="llm" if escalated else "jev",
        model="m",
        latency_ms=1.0,
        input_tokens=0,
        output_tokens=0,
        reasoning_tokens=0,
        cost_usd=0.0,
        escalated=escalated,
        illegal_attempts=0,
        jev_confidence=None,
        jev_margin=None,
        jev_top_uci=jev_top,
    )


@pytest.mark.parametrize(
    ("loss", "cls"),
    [
        (0, "best"),
        (10, "good"),
        (50, "inaccuracy"),
        (100, "mistake"),
        (299, "mistake"),
        (300, "blunder"),
    ],
)
def test_classify(loss: int, cls: str) -> None:
    assert classify(loss) == cls


def test_grade_one_measures_played_and_jev_moves() -> None:
    # Scripted values are White-POV. Before: +30. After e2e4 still +30 -> mover keeps 30, loss 0.
    # After a2a3 (Jev's top): -20 for White -> mover -20, loss 50.
    oracle = ScriptedOracle([30, 30, -20])
    grade = grade_one(oracle, ply("e2e4", escalated=True, jev_top="a2a3"))
    assert (grade.cp_loss, grade.move_class, grade.eval_before_cp, grade.eval_after_cp) == (
        0,
        "best",
        30,
        30,
    )
    assert grade.jev_top_cp_loss == 50
    assert grade.override is True
    assert grade.override_gain_cp == 50


def test_grade_one_mate_and_drawn_positions() -> None:
    mate_board = "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1"
    oracle = ScriptedOracle([900])
    grade = grade_one(oracle, ply("a1a8", fen=mate_board))
    assert grade.eval_after_cp == 100_000
    assert grade.cp_loss == 0
    stalemate_board = (
        "7k/5Q2/6K1/8/8/8/8/8 w - - 0 1"  # Qf7 would stalemate? use Kg7 stalemates: choose Qg6?
    )
    board = chess.Board(stalemate_board)
    stalemating = next(
        m for m in board.legal_moves if (board.push(m), board.is_stalemate(), board.pop())[1]
    )
    oracle2 = ScriptedOracle([5000])
    grade2 = grade_one(oracle2, ply(stalemating.uci(), fen=stalemate_board))
    assert grade2.eval_after_cp == 0
    assert grade2.cp_loss == 1000


def test_grade_plies_parallel_preserves_order_and_no_override_when_same_move() -> None:
    def open_oracle() -> Oracle:
        return Oracle(FakeBackend(scripted_infos=[info("e2e4", cp=10)]), OracleConfig(depth=4))

    plies = [ply("e2e4", n=1), ply("d2d4", n=2, escalated=True, jev_top="d2d4"), ply("e2e4", n=3)]
    grades = grade_plies(plies, open_oracle, workers=2)
    assert [g.ply for g in grades] == [1, 2, 3]
    assert grades[1].override is False
    assert grades[1].override_gain_cp is None
    assert grades[1].jev_top_cp_loss is not None
    assert grade_plies([], open_oracle) == []


# --- elo ----------------------------------------------------------------------------------


def test_anchor_rating_and_expected() -> None:
    from jev_chess.analysis import is_engine

    assert anchor_rating("maia:1500") == 1500
    assert anchor_rating("stockfish:1600") is None  # fitted, not anchored (see calibration)
    assert anchor_rating("jev") is None
    assert is_engine("stockfish:skill:3")
    assert is_engine("random")
    assert not is_engine("hybrid:claude-opus-5:low:k5:t0.9:margin")
    assert expected(1500, 1500) == 0.5
    assert expected(1900, 1500) > 0.9


def game(white: str, black: str, result: Result) -> GameRecord:
    return GameRecord(
        game_id=f"{white}-{black}-{result}",
        white=white,
        black=black,
        opening="o",
        opening_plies=0,
        result=result,
        termination="checkmate",
        plies=10,
        final_fen=chess.STARTING_FEN,
        pgn="",
        white_totals=SideTotals(player=white, plies=5, cost_usd=0.5, latency_ms=10),
        black_totals=SideTotals(player=black, plies=5),
    )


def test_fit_elo_places_player_between_anchors() -> None:
    games = (
        [game("x", "maia:1100", "1-0")] * 8
        + [game("maia:1100", "x", "0-1")] * 8
        + [game("x", "maia:1900", "0-1")] * 8
        + [game("maia:1900", "x", "1-0")] * 8
        + [game("x", "maia:1500", "1/2-1/2")] * 8
    )
    ratings = fit_elo(pairings(games))
    assert ratings["maia:1100"] == 1100
    assert ratings["maia:1900"] == 1900
    assert 1350 < ratings["x"] < 1650
    assert fit_elo([]) == {}
    assert fit_elo(pairings([game("maia:1100", "maia:1500", "1-0")])) == {
        "maia:1100": 1100,
        "maia:1500": 1500,
    }
    assert fit_elo(pairings([game("a", "b", "1-0")]), anchors={"a": 1000})["b"] < 1000


# --- report -------------------------------------------------------------------------------


def test_summarise_and_pareto() -> None:
    games = [game("hyb", "maia:1100", "1-0"), game("maia:1100", "hyb", "1/2-1/2")]
    plies = [
        ply("e2e4", n=1).model_copy(
            update={"player": "hyb", "escalated": True, "source": "llm", "latency_ms": 2000.0}
        ),
        ply("d2d4", n=2).model_copy(update={"player": "hyb", "latency_ms": 300.0}),
        ply("e7e5", n=3).model_copy(
            update={"player": "maia:1100", "source": "engine", "illegal_attempts": 0}
        ),
    ]
    grades = [
        GradeRecord(
            game_id="g",
            ply=1,
            player="hyb",
            source="llm",
            escalated=True,
            best_uci="e2e4",
            eval_before_cp=10,
            eval_after_cp=10,
            cp_loss=0,
            move_class="best",
            jev_top_cp_loss=350,
            override=True,
            override_gain_cp=350,
        ),
        GradeRecord(
            game_id="g",
            ply=2,
            player="hyb",
            source="jev",
            escalated=False,
            best_uci="d2d4",
            eval_before_cp=10,
            eval_after_cp=-300,
            cp_loss=310,
            move_class="blunder",
        ),
    ]
    summaries = summarise(games, plies, grades)
    hyb = summaries["hyb"]
    assert (hyb.games, hyb.wins, hyb.draws, hyb.losses) == (2, 1, 1, 0)
    assert hyb.score == 0.75
    assert hyb.cost_usd == 0.5
    assert hyb.cost_per_game == 0.25
    assert hyb.plies == 2
    assert hyb.mean_latency_ms == 1150.0
    assert hyb.median_latency_ms == 1150.0
    assert hyb.escalation_rate == 0.5
    assert hyb.acpl == 155
    assert hyb.blunder_rate == 0.5
    assert hyb.override_rate == 1.0
    assert hyb.mean_override_gain_cp == 350
    assert hyb.elo is not None
    assert hyb.elo > 1100
    maia = summaries["maia:1100"]
    assert maia.elo == 1100
    assert maia.acpl is None
    assert maia.blunder_rate is None
    assert maia.override_rate is None
    assert maia.mean_override_gain_cp is None
    rows = pareto_rows(list(summaries.values()))
    assert [r.player for r in rows] == ["hyb"]
    from jev_chess.analysis import anchor_rows

    assert [r.player for r in anchor_rows(list(summaries.values()))] == ["maia:1100"]
    empty = summarise([], [], [])
    assert empty == {}


def test_summary_defaults_for_player_without_plies() -> None:
    from jev_chess.analysis import PlayerSummary

    s = PlayerSummary(player="ghost")
    assert s.score == 0.0
    assert s.mean_latency_ms == 0.0
    assert s.median_latency_ms == 0.0
    assert s.cost_per_game == 0.0
    assert s.escalation_rate == 0.0


# --- CLI ----------------------------------------------------------------------------------


def test_play_command_with_workers_and_budget(tmp_path: Path) -> None:
    out = tmp_path / "rr"
    result = runner.invoke(
        app,
        [
            "play",
            "--white",
            "random",
            "--black",
            "random",
            "--games",
            "4",
            "--out",
            str(out),
            "--max-plies",
            "6",
            "--workers",
            "2",
            "--no-adjudicate",
            "--max-usd",
            "5",
        ],
    )
    assert result.exit_code == 0, result.output
    assert "4 games written" in result.output
    assert len(list(read_jsonl(out / "games.jsonl", GameRecord))) == 4


def test_sweep_grade_report_commands(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    out = tmp_path / "sweep"
    result = runner.invoke(
        app,
        [
            "sweep",
            "--players",
            "random",
            "--opponents",
            "random",
            "--out",
            str(out),
            "--games",
            "2",
            "--max-plies",
            "10",
            "--workers",
            "1",
            "--no-adjudicate",
        ],
    )
    assert result.exit_code == 0, result.output
    assert (out / "random__random" / "games.jsonl").exists()

    monkeypatch.setattr(
        Oracle,
        "open",
        classmethod(
            lambda cls, path, config: Oracle(
                FakeBackend(scripted_infos=[info("e2e4", cp=5)]), config
            )
        ),
    )
    monkeypatch.setattr("jev_chess.cli.EngineSettings", lambda: EngineSettings(_env_file=None))
    graded = runner.invoke(app, ["grade", "--run", str(out), "--depth", "6", "--workers", "2"])
    assert graded.exit_code == 0, graded.output
    assert (out / "grades.jsonl").exists()

    reported = runner.invoke(app, ["report", "--run", str(out)], env={"COLUMNS": "250"})
    assert reported.exit_code == 0, reported.output
    assert "random" in reported.output

    assert runner.invoke(app, ["grade", "--run", str(tmp_path / "nothing")]).exit_code != 0
    assert runner.invoke(app, ["report", "--run", str(tmp_path / "nothing")]).exit_code != 0


def test_play_command_rejects_bad_spec_via_match(tmp_path: Path) -> None:
    assert (
        runner.invoke(
            app, ["play", "--white", "wizard", "--black", "random", "--out", str(tmp_path)]
        ).exit_code
        != 0
    )


def test_report_command_shows_anchor_table(tmp_path: Path) -> None:
    from jev_chess.analysis import write_jsonl

    run = tmp_path / "run"
    write_jsonl(
        run / "games.jsonl", [game("jev", "maia:1100", "0-1"), game("maia:1100", "jev", "1-0")]
    )
    write_jsonl(run / "plies.jsonl", [ply("e2e4", n=1).model_copy(update={"player": "jev"})])
    result = runner.invoke(app, ["report", "--run", str(run)], env={"COLUMNS": "250"})
    assert result.exit_code == 0, result.output
    assert "maia:1100" in result.output
    assert "1100" in result.output


def test_sweep_shares_one_budget_across_pairings(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from jev_chess.runner import players as players_module

    class Pricey(RandomPlayer):
        def decide(self, board: chess.Board, game_id: str, ply: int) -> MoveDecision:
            d = super().decide(board, game_id, ply)
            return MoveDecision(
                uci=d.uci, source="llm", model="pricey", latency_ms=0.0, cost_usd=0.5
            )

    monkeypatch.setattr(players_module, "RandomPlayer", Pricey)
    out = tmp_path / "sweep"
    result = runner.invoke(
        app,
        [
            "sweep",
            "--players",
            "random",
            "--opponents",
            "random,random",
            "--out",
            str(out),
            "--games",
            "3",
            "--max-plies",
            "10",
            "--workers",
            "1",
            "--no-adjudicate",
            "--max-usd",
            "3",
        ],
    )
    assert result.exit_code == 0, result.output
    assert "skipped by --max-usd" in result.output
    assert "sweep spent $" in result.output


def test_sweep_continues_past_a_failed_pairing(tmp_path: Path) -> None:
    out = tmp_path / "sweep"
    result = runner.invoke(
        app,
        [
            "sweep",
            "--players",
            "wizard,random",
            "--opponents",
            "random",
            "--out",
            str(out),
            "--games",
            "1",
            "--max-plies",
            "8",
            "--workers",
            "1",
            "--no-adjudicate",
        ],
    )
    assert result.exit_code == 1
    assert "wizard__random failed" in result.output
    assert (out / "random__random" / "games.jsonl").exists()
    assert "1 pairing(s) failed" in result.output
