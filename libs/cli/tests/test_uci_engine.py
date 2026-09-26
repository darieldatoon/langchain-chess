import asyncio
import io

import pytest

from langchain_chess import create_chess_agent
from langchain_chess.testing import ScriptedModel
from langchain_chess_cli.options import AgentOptions
from langchain_chess_cli.uci.engine import Engine, run
from langchain_chess_systemone import SystemOneMiddleware
from langchain_chess_systemone.testing import FakeRanker, distribution

INSUFFICIENT = "8/8/8/4k3/8/8/8/4K3 w - - 0 1"


class Factory:
    """Builds agents around one shared scripted model, recording every build's options."""

    def __init__(self, script, *, delay=0.0, systemone=None):
        self.model = ScriptedModel(script=list(script), delay=delay)
        self.systemone = systemone
        self.builds: list[AgentOptions] = []

    def __call__(self, options, checkpointer):
        self.builds.append(options)
        middleware = [self.systemone] if self.systemone is not None else []
        return create_chess_agent(
            self.model, middleware=middleware, draw_claims="never", checkpointer=checkpointer
        )


class Harness:
    def __init__(self, factory, options=None):
        self.lines: list[str] = []
        self.factory = factory
        self.engine = Engine(factory, options, out=self.lines.append)

    async def send(self, *commands):
        for command in commands:
            await self.engine.handle(command)

    async def wait_for(self, prefix, count=1, timeout=3.0):
        async def ready():
            while sum(line.startswith(prefix) for line in self.lines) < count:
                await asyncio.sleep(0.005)

        await asyncio.wait_for(ready(), timeout)

    def bestmoves(self):
        return [line.split()[1] for line in self.lines if line.startswith("bestmove")]

    def infos(self):
        return [line.removeprefix("info string ") for line in self.lines if line.startswith("info")]


async def test_uci_handshake_and_isready():
    h = Harness(Factory([]))
    await h.send("uci", "isready")
    assert h.lines[0] == "id name langchain-chess"
    assert h.lines[1] == "id author Dariel Dato-on"
    assert (
        "option name ReasoningEffort type combo default default"
        " var default var low var medium var high" in h.lines
    )
    assert (
        "option name Policy type combo default hybrid var llm var systemone var hybrid" in h.lines
    )
    assert not any("Ponder" in line for line in h.lines)
    assert h.lines[-2:] == ["uciok", "readyok"]


async def test_a_search_commits_and_prints_bestmove_with_analysis():
    h = Harness(Factory(["Solid.\n\nCentral pawn.\nMOVE: e5"]))
    await h.send("position startpos moves e2e4", "go movetime 5000")
    await h.wait_for("bestmove")
    assert h.bestmoves() == ["e7e5"]
    assert h.infos() == ["Solid.", "Central pawn.", "MOVE: e5"]


async def test_a_game_continues_on_the_same_thread():
    factory = Factory(["MOVE: e5", "MOVE: Nc6"])
    h = Harness(factory)
    await h.send("ucinewgame", "position startpos moves e2e4", "go wtime 60000 btime 60000")
    await h.wait_for("bestmove")
    await h.send("position startpos moves e2e4 e7e5 g1f3", "go wtime 59000 btime 59000 winc 100")
    await h.wait_for("bestmove", 2)
    assert h.bestmoves() == ["e7e5", "b8c6"]
    # The second request only showed the new moves: one thread, one game.
    assert factory.model.requests[1][-2].content == "2. Nf3"


async def test_stop_before_commit_then_the_fallback_enters_as_an_external_move():
    ranker = FakeRanker(lambda r: distribution(dict(zip(r.options[:2], (0.6, 0.4), strict=True))))
    systemone = SystemOneMiddleware("fake", threshold=1.0, ranker=ranker)
    factory = Factory(["MOVE: e5", "MOVE: Nf3"], delay=5.0, systemone=systemone)
    h = Harness(factory)
    await h.send("position startpos moves e2e4", "go infinite")
    await asyncio.sleep(0.2)
    await h.send("stop")
    top = ranker.requests[0].options[0]
    assert h.bestmoves() == [top]  # System 1's top move is the fallback
    factory.model.delay = 0.0
    await h.send(f"position startpos moves e2e4 {top}", "go movetime 3000")
    await h.wait_for("bestmove", 2)
    values = (await h.engine._agent.aget_state(h.engine._config())).values
    assert [t["status"] for t in values["turns"]] == ["abandoned", "committed"]
    assert values["plies"][1]["source"] == "external"
    assert values["plies"][1]["uci"] == top


async def test_the_deadline_plays_a_seeded_fallback():
    factory = Factory(["MOVE: e5"], delay=5.0)
    h = Harness(factory)
    await h.send("position startpos moves e2e4", "go movetime 200")
    await h.wait_for("bestmove")
    (move,) = h.bestmoves()
    assert move in {
        "a7a6",
        "a7a5",
        "b7b6",
        "b7b5",
        "c7c6",
        "c7c5",
        "d7d6",
        "d7d5",
        "e7e6",
        "e7e5",
        "f7f6",
        "f7f5",
        "g7g6",
        "g7g5",
        "h7h6",
        "h7h5",
        "b8a6",
        "b8c6",
        "g8f6",
        "g8h6",
    }


async def test_a_provider_failure_before_the_deadline():
    h = Harness(Factory([RuntimeError("provider down")]))
    await h.send("position startpos", "go movetime 5000")
    await h.wait_for("bestmove")
    assert h.infos() == ["error: provider down"]
    assert len(h.bestmoves()) == 1


async def test_insufficient_material_is_game_over():
    h = Harness(Factory([]))
    await h.send(f"position fen {INSUFFICIENT}", "go movetime 1000")
    await h.wait_for("bestmove")
    assert h.infos() == ["game over: Draw by insufficient material. 1/2-1/2"]
    assert h.bestmoves() == ["0000"]


async def test_resignation():
    h = Harness(Factory(["MOVE: Qh5"] * 4))
    await h.send("position startpos", "go movetime 5000")
    await h.wait_for("bestmove")
    assert h.infos()[-1] == "resigns: no legal move after 4 attempts"
    assert h.bestmoves() == ["0000"]


async def test_illegal_searchmoves_only_are_rejected():
    h = Harness(Factory([]))
    await h.send("position startpos", "go movetime 1000 searchmoves e2e5 a1a8")
    await h.wait_for("bestmove")
    assert h.infos() == ["ignoring illegal searchmoves: e2e5 a1a8", "restrict must not be empty"]
    assert h.bestmoves() == ["0000"]


async def test_searchmoves_restrict_the_search():
    factory = Factory(["MOVE: e4", "MOVE: d4"])
    h = Harness(factory)
    await h.send("position startpos", "go movetime 3000 searchmoves d2d4 zz")
    await h.wait_for("bestmove")
    assert h.bestmoves() == ["d2d4"]
    assert h.infos()[0] == "ignoring illegal searchmoves: zz"


async def test_a_takeback_starts_a_new_thread():
    factory = Factory(["MOVE: e5", "MOVE: c5"])
    h = Harness(factory)
    await h.send("position startpos moves e2e4", "go movetime 3000")
    await h.wait_for("bestmove")
    first = h.engine._thread
    await h.send("position startpos moves e2e4", "go movetime 3000")
    await h.wait_for("bestmove", 2)
    assert h.engine._thread != first
    assert h.bestmoves() == ["e7e5", "c7c5"]


async def test_a_different_root_starts_a_new_thread():
    h = Harness(Factory(["MOVE: e5", "MOVE: Kd2"]))
    await h.send("position startpos moves e2e4", "go movetime 3000")
    await h.wait_for("bestmove")
    first = h.engine._thread
    await h.send("position fen 4k3/8/8/8/8/8/3P4/4K2R w K - 0 1", "go movetime 3000")
    await h.wait_for("bestmove", 2)
    assert h.engine._thread != first


async def test_isready_during_a_search_setoption_queued_and_quit_mid_search():
    factory = Factory(["MOVE: e5"], delay=5.0)
    h = Harness(factory)
    await h.send("position startpos moves e2e4", "go infinite", "isready")
    assert h.lines[-1] == "readyok"
    await h.send("setoption name K value 3")
    assert h.engine.options.k == 5
    await h.send("quit")
    assert len(h.bestmoves()) == 1
    assert h.engine.quitting
    assert h.engine.options.k == 3


async def test_go_infinite_setoption_isready_then_the_next_search_uses_it():
    factory = Factory(["MOVE: e5", "MOVE: Nc6"], delay=5.0)
    h = Harness(factory)
    await h.send("position startpos moves e2e4", "go infinite")
    await h.send("setoption name Seed value 7", "isready")
    assert h.lines[-1] == "readyok"
    assert h.bestmoves() == []
    await h.send("stop")
    assert len(h.bestmoves()) == 1
    assert factory.builds[-1].seed == 7


async def test_go_infinite_finishing_holds_until_stop():
    h = Harness(Factory(["MOVE: e5"]))
    await h.send("position startpos moves e2e4", "go infinite")
    await asyncio.sleep(0.2)
    assert h.bestmoves() == []
    await h.send("stop")
    assert h.bestmoves() == ["e7e5"]
    await h.send("stop")
    assert h.bestmoves() == ["e7e5"]


async def test_ponderhit_switches_to_a_deadline():
    h = Harness(Factory(["MOVE: e5"], delay=5.0))
    await h.send("position startpos moves e2e4", "go ponder wtime 1000 btime 1000")
    await asyncio.sleep(0.05)
    await h.send("ponderhit")
    await h.wait_for("bestmove")
    assert len(h.bestmoves()) == 1


async def test_ponderhit_after_the_result_is_ready_releases_it():
    h = Harness(Factory(["MOVE: e5"]))
    await h.send("position startpos moves e2e4", "go ponder btime 1000")
    await asyncio.sleep(0.2)
    await h.send("ponderhit")
    assert h.bestmoves() == ["e7e5"]
    await h.send("ponderhit")
    assert h.bestmoves() == ["e7e5"]


async def test_go_or_ucinewgame_during_a_search_settles_it_first():
    factory = Factory(["MOVE: e5", "MOVE: c5", "MOVE: d5"], delay=5.0)
    h = Harness(factory)
    await h.send("position startpos moves e2e4", "go infinite")
    factory.model.delay = 0.0
    await h.send("go movetime 3000")
    assert len(h.bestmoves()) == 1
    await h.wait_for("bestmove", 2)
    factory.model.delay = 5.0
    await h.send("ucinewgame", "position startpos moves e2e4", "go infinite", "ucinewgame")
    assert len(h.bestmoves()) == 3


async def test_a_late_result_from_a_retired_search_is_ignored():
    factory = Factory(["MOVE: e5", "MOVE: c5"], delay=0.3)
    h = Harness(factory)
    await h.send("position startpos moves e2e4", "go movetime 100")
    await h.wait_for("bestmove")
    old = h.engine._search
    assert old is None
    await asyncio.sleep(0.4)
    assert len(h.bestmoves()) == 1


async def test_setoption_rebuilds_when_idle_and_rejects_bad_values():
    factory = Factory([])
    h = Harness(factory)
    await h.send(
        "setoption name policy value llm",
        "setoption name Threshold value 0.5",
        "setoption name Threshold value 2",
        "setoption name K value lots",
        "setoption name K value 999",
        "setoption name Nope value 1",
        "setoption name ReasoningEffort value extreme",
        "setoption name Model",
        "setoption name Memory value summarize",
        "setoption name Memory value full",
    )
    assert h.engine.options.memory == "summarize"
    assert h.engine.options.policy == "llm"
    assert h.engine.options.threshold == 0.5
    assert h.engine.options.model == ""
    assert h.infos() == [
        "invalid value for Threshold: expected a number within 0..1",
        "invalid value for K: invalid literal for int() with base 10: 'lots'",
        "invalid value for K: expected an integer within 1..255",
        "unknown option: Nope",
        "invalid value for ReasoningEffort: expected one of default, low, medium, high",
        "invalid value for Memory: expected one of none, summarize",
    ]
    assert len(factory.builds) == 5


async def test_reasoning_effort_default_sends_none():
    h = Harness(Factory([]))
    await h.send("setoption name ReasoningEffort value high")
    assert h.engine.options.reasoning_effort == "high"
    await h.send("setoption name ReasoningEffort value default")
    assert h.engine.options.reasoning_effort is None


async def test_stop_when_idle_unknown_commands_and_blank_lines():
    h = Harness(Factory([]))
    await h.send("stop", "ponderhit", "", "xyzzy", "position")
    assert h.infos() == ["unknown command: xyzzy", "unknown command: position"]


async def test_run_reads_until_quit_or_eof():
    h = Harness(Factory([]))
    await run(h.engine, io.StringIO("isready\nquit\nisready\n"))
    assert h.lines == ["readyok"]
    h = Harness(Factory([]))
    await run(h.engine, io.StringIO("isready\n"))
    assert h.engine.quitting


@pytest.mark.parametrize("fen", ["not a fen", "8/8/8/8/8/8/8/8 w - - 0 1"])
async def test_an_invalid_position_is_rejected(fen):
    h = Harness(Factory([]))
    await h.send(f"position fen {fen}", "go movetime 1000")
    await h.wait_for("bestmove")
    assert h.bestmoves() == ["0000"]
    assert h.infos()[0].startswith("invalid")


async def test_legal_searchmoves_drop_nothing():
    h = Harness(Factory(["MOVE: d4"]))
    await h.send("position startpos", "go movetime 3000 searchmoves d2d4 e2e4")
    await h.wait_for("bestmove")
    assert h.infos() == ["MOVE: d4"]
    assert h.bestmoves() == ["d2d4"]


async def test_an_invalid_fen_after_a_game_starts_a_new_thread():
    h = Harness(Factory(["MOVE: e5"]))
    await h.send("position startpos moves e2e4", "go movetime 3000")
    await h.wait_for("bestmove")
    first = h.engine._thread
    await h.send("position fen nope", "go movetime 1000")
    await h.wait_for("bestmove", 2)
    assert h.engine._thread != first
    assert h.bestmoves()[-1] == "0000"
