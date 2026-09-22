from dataclasses import dataclass
from typing import Any, cast

import chess
import pytest
from langgraph.checkpoint.memory import InMemorySaver

from jev_chess.graphs import PlayContext, build_game_graph, make_game_graph, mover_for
from jev_chess.graphs import game as game_module
from jev_chess.graphs import movers as movers_module
from jev_chess.graphs.game import outcome_of, parse_move
from jev_chess.graphs.movers import (
    Mover,
    RandomState,
    build_random_graph,
    hybrid_mover,
    jev_mover,
    llm_mover,
    random_mover,
)
from jev_chess.policies import HybridConfig, HybridPolicy, JevPolicy, LLMConfig, LLMPolicy
from tests.fake_jev import FakeClassifier, choice_response
from tests.fake_llm import FakeChatModel, reply

SURE = {"e7e5": 0.9, "c7c5": 0.05, "e7e6": 0.03, "g8f6": 0.02}
AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"


def jev_policy() -> JevPolicy:
    return JevPolicy(FakeClassifier(scripted=choice_response(SURE, 0.8, model="jev-1.13.0")))


def game(context: PlayContext, mover: Mover) -> Any:
    return build_game_graph(context, mover)


def test_human_move_then_jev_reply_with_telemetry() -> None:
    ctx = PlayContext(policy="jev")
    result = game(ctx, jev_mover(jev_policy())).invoke({"move": "e2e4"})
    assert result["history"] == ["e4", "e5"]
    assert result["moves"] == ["e2e4", "e7e5"]
    assert result["status"] == "playing"
    assert result["player"] == "jev"
    assert result["human_side"] == "white"
    assert (result["error"], result["move"]) == (None, None)
    human, jev = result["plies"]
    assert (human["source"], human["ply"], human["side"]) == ("human", 1, "white")
    assert (jev["source"], jev["model"], jev["side"]) == ("jev", "jev-1.13.0", "black")
    assert jev["jev_top"][0] == {"uci": "e7e5", "san": "e5", "probability": 0.9}
    assert jev["jev_margin"] == pytest.approx(0.85)
    assert jev["cost_usd"] == pytest.approx(100 * 0.042 / 1e6)


def threaded(context: PlayContext, mover: Mover) -> tuple[Any, Any]:
    """A game graph with a checkpointer, as the Agent Server runs it, plus its thread config."""
    g = build_game_graph(context, mover).copy(update={"checkpointer": InMemorySaver()})
    return g, {"configurable": {"thread_id": "t1"}}


def test_thread_continues_across_runs_with_a_checkpointer() -> None:
    g, config = threaded(PlayContext(policy="random"), random_mover(seed=1))
    first = g.invoke({"move": "Nf3"}, config=config)
    assert first["history"][0] == "Nf3"
    assert len(first["moves"]) == 2
    second = g.invoke({"move": "d4"}, config=config)
    assert len(second["moves"]) == 4
    assert second["plies"][2]["san"] == "d4"


def test_black_human_lets_policy_open() -> None:
    result = game(PlayContext(policy="random", human_side="black"), random_mover()).invoke({})
    assert len(result["moves"]) == 1
    assert result["plies"][0]["side"] == "white"
    assert result["human_side"] == "black"


def test_errors_do_not_call_the_policy() -> None:
    llm = FakeChatModel([reply("MOVE: e5")])
    g = game(PlayContext(policy="llm"), llm_mover(LLMPolicy(llm, LLMConfig())))
    illegal = g.invoke({"move": "e2e5"})
    assert illegal["error"] == "e2e5 is not a legal move here."
    assert "moves" not in illegal  # nothing was written, so the channel is absent
    assert llm.calls == []
    waiting = g.invoke({})
    assert waiting["error"] is None
    assert "moves" not in waiting

    g, config = threaded(PlayContext(policy="llm"), llm_mover(LLMPolicy(llm, LLMConfig())))
    g.update_state(config, {"fen": AFTER_E4}, as_node="policy_move")
    assert g.invoke({"move": "e7e5"}, config=config)["error"] == "It is not your move."
    g.update_state(config, {"status": "checkmate"}, as_node="policy_move")
    over = g.invoke({"move": "e2e4"}, config=config)
    assert over["error"] == "The game is over (checkmate)."
    assert llm.calls == []


def test_llm_and_hybrid_movers_map_decisions() -> None:
    llm = FakeChatModel([reply("I like the centre.\nMOVE: e5", 400, 200, 150)])
    result = game(PlayContext(policy="llm"), llm_mover(LLMPolicy(llm, LLMConfig()))).invoke(
        {"move": "e2e4"}
    )
    ply = result["plies"][1]
    assert (ply["source"], ply["reasoning_tokens"], ply["escalated"]) == ("llm", 150, False)
    assert "MOVE: e5" in ply["raw_reply"]

    hybrid = HybridPolicy(
        jev_policy(), LLMPolicy(FakeChatModel([reply("MOVE: c5")])), HybridConfig(threshold=1.0)
    )
    result = game(PlayContext(), hybrid_mover(hybrid)).invoke({"move": "e2e4"})
    ply = result["plies"][1]
    assert (ply["source"], ply["escalated"], ply["san"]) == ("llm", True, "c5")
    assert [c["uci"] for c in ply["jev_top"]] == ["e7e5", "c7c5", "e7e6", "g8f6"]


def test_checkmate_and_max_plies_end_the_game() -> None:
    # Fool's mate: the human, playing Black, mates with Qh4 and the policy must not reply.
    board = chess.Board()
    for uci in ("f2f3", "e7e5", "g2g4"):
        board.push_uci(uci)
    g, config = threaded(PlayContext(policy="random", human_side="black"), random_mover())
    g.update_state(
        config,
        {"fen": board.fen(), "history": ["f3", "e5", "g4"], "moves": ["f2f3", "e7e5", "g2g4"]},
        as_node="policy_move",
    )
    result = g.invoke({"move": "Qh4"}, config=config)
    assert (result["status"], result["result"]) == ("checkmate", "0-1")
    assert len(result["moves"]) == 4

    capped = game(PlayContext(policy="random", max_plies=1), random_mover()).invoke(
        {"move": "e2e4"}
    )
    assert (capped["status"], capped["result"]) == ("max_plies", "1/2-1/2")
    assert len(capped["moves"]) == 1


def test_outcome_of_covers_stalemate_and_draws() -> None:
    stalemate = chess.Board("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1")
    assert outcome_of(stalemate, 10, 200) == ("stalemate", "1/2-1/2")
    bare_kings = chess.Board("8/8/8/4k3/8/8/8/4K3 w - - 0 1")
    assert outcome_of(bare_kings, 10, 200) == ("draw", "1/2-1/2")
    assert parse_move(chess.Board(), "zzz") is None


def test_random_graph_is_seeded_and_legal() -> None:
    a = build_random_graph(3).invoke(RandomState(fen=chess.STARTING_FEN))["decision"]
    b = build_random_graph(3).invoke(RandomState(fen=chess.STARTING_FEN))["decision"]
    assert (a.uci, a.source, a.model) == (b.uci, "engine", "random")


def test_policy_graph_is_detected_as_subgraph() -> None:
    g = build_game_graph(PlayContext(policy="jev"), jev_mover(jev_policy()))
    names = [name for name, _ in g.get_subgraphs()]
    assert names == ["policy_move"]
    schema = g.get_context_jsonschema()
    assert schema is not None
    props = schema["properties"]
    assert props["threshold"]["langgraph_nodes"] == ["rank_jev"]
    assert props["policy"]["default"] == "hybrid"
    assert set(g.get_input_jsonschema()["properties"]) == {"move"}


def test_policy_call_carries_game_metadata() -> None:
    seen: list[dict[str, Any]] = []
    inner = random_mover()

    class Spy:
        def invoke(self, state: Any, config: Any = None) -> dict[str, Any]:
            seen.append(config)
            return inner.graph.invoke(state)

    mover = Mover(graph=cast("Any", Spy()), to_input=inner.to_input, to_decision=inner.to_decision)
    game(PlayContext(policy="random"), mover).invoke(
        {"move": "e2e4"}, config={"configurable": {"thread_id": "abc"}}
    )
    assert seen[0]["run_name"] == "random ply 2"
    assert seen[0]["metadata"].items() >= {"game_id": "abc", "ply": 2, "player": "random"}.items()
    assert seen[0]["configurable"]["thread_id"] == "abc"


def test_mover_for_builds_each_policy(monkeypatch: pytest.MonkeyPatch) -> None:
    built: list[str] = []
    monkeypatch.setattr(
        movers_module.JevPolicy,
        "from_settings",
        classmethod(lambda cls, s=None, c=None, cs=None: (built.append("jev"), jev_policy())[1]),
    )
    monkeypatch.setattr(
        movers_module.LLMPolicy,
        "from_settings",
        classmethod(
            lambda cls, s=None, c=None, cs=None: (
                built.append("llm"),
                LLMPolicy(FakeChatModel([reply("MOVE: e5")]), c),
            )[1]
        ),
    )
    monkeypatch.setattr(
        movers_module.HybridPolicy,
        "from_settings",
        classmethod(
            lambda cls, s=None, c=None, cs=None: (
                built.append("hybrid"),
                HybridPolicy(jev_policy(), LLMPolicy(FakeChatModel([reply("MOVE: e5")])), c),
            )[1]
        ),
    )
    for policy in ("random", "jev", "llm", "hybrid"):
        mover = mover_for(PlayContext(policy=cast("Any", policy)))
        assert mover.graph is not None
    assert built == ["jev", "llm", "hybrid"]


@dataclass
class Runtime:
    execution_runtime: None = None


def test_make_game_graph_reads_configurable(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: list[PlayContext] = []

    def fake_mover_for(context: PlayContext, settings: Any = None) -> Mover:
        captured.append(context)
        return random_mover()

    monkeypatch.setattr(game_module, "mover_for", fake_mover_for)
    config: Any = {"configurable": {"policy": "random", "human_side": "black"}}
    g: Any = make_game_graph(config, cast("Any", Runtime()))
    result = g.invoke({})
    assert (captured[0].policy, captured[0].human_side) == ("random", "black")
    assert len(result["moves"]) == 1


def test_policy_failure_is_recorded_and_the_thread_stays_playable() -> None:
    class Boom:
        def invoke(self, state: Any, config: Any = None) -> dict[str, Any]:
            raise RuntimeError("400 text content blocks must be non-empty")

    inner = random_mover()
    broken = Mover(
        graph=cast("Any", Boom()), to_input=inner.to_input, to_decision=inner.to_decision
    )
    g, config = threaded(PlayContext(policy="random"), broken)
    failed = g.invoke({"move": "e2e4"}, config=config)
    assert failed["history"] == ["e4"]
    assert failed["status"] == "playing"
    assert failed["error"] == "random failed to move: 400 text content blocks must be non-empty"

    # Empty submit retries the opponent once the policy works again.
    working: Any = build_game_graph(PlayContext(policy="random"), inner).copy(
        update={"checkpointer": g.checkpointer}
    )
    retried = working.invoke({}, config=config)
    assert retried["error"] is None
    assert len(retried["history"]) == 2
