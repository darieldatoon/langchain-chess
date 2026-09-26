import asyncio
import sys
from concurrent.futures import ThreadPoolExecutor
from typing import Annotated, Any, NotRequired

import pytest
from langchain.agents.middleware import ModelRetryMiddleware
from langchain.agents.middleware.types import (
    AgentMiddleware,
    ExtendedModelResponse,
    ModelResponse,
    PrivateStateAttr,
    hook_config,
)
from langchain_core.messages import AIMessage
from langchain_core.tools import tool
from langchain_openai import StreamChunkTimeoutError
from langgraph.types import Command
from langsmith import tracing_context

from langchain_chess import (
    ChessContractError,
    ChessMiddleware,
    ChessState,
    ContextBudgetError,
    create_chess_agent,
    turn_cost,
)
from langchain_chess.contract import guard
from langchain_chess.middleware.stall_retry import stall_errors
from langchain_chess.recorder import _SINK
from langchain_chess.testing import ScriptedModel, human, position, topology


class Pruner(ChessMiddleware):
    def __init__(self, label: str, keep: list[str]) -> None:
        self.label = label
        self.keep = keep

    @property
    def name(self) -> str:
        return self.label

    def before_model(self, state, runtime):
        return self.narrow(state, self.keep)

    async def abefore_model(self, state, runtime):
        return self.narrow(state, self.keep)


class Writes(ChessMiddleware):
    """Returns a fixed update from `before_model`."""

    def __init__(self, update: Any, label: str = "Writes") -> None:
        self.update = update
        self.label = label

    @property
    def name(self) -> str:
        return self.label

    def before_model(self, state, runtime):
        return self.update(state) if callable(self.update) else self.update

    async def abefore_model(self, state, runtime):
        return self.before_model(state, runtime)


class ProposerState(ChessState):
    proposer_note: NotRequired[Annotated[str, PrivateStateAttr]]


class Proposer(ChessMiddleware):
    state_schema = ProposerState

    @hook_config(can_jump_to=["end"])
    def before_model(self, state, runtime):
        return {**self.propose("d2d4", meta={"model": "book"}), "proposer_note": "played"}

    @hook_config(can_jump_to=["end"])
    async def abefore_model(self, state, runtime):
        return self.before_model(state, runtime)

    def ply_meta(self, state):
        return {"note": state.get("proposer_note"), "board": self.position(state).board().fen()}


class InheritedProposer(Proposer):
    pass


class CustomNamed(Proposer):
    @property
    def name(self) -> str:
        return "Book"


class AsyncOnlyProposer(ChessMiddleware):
    @hook_config(can_jump_to=["end"])
    async def abefore_model(self, state, runtime):
        return self.propose("g1f3", source="asyncbook", analysis="book move")


class RaiseOnce(AgentMiddleware):
    def __init__(self, hook: str) -> None:
        self.hook = hook
        self.raised = False

    def _maybe(self) -> None:
        if not self.raised:
            self.raised = True
            msg = f"{self.hook} failed"
            raise RuntimeError(msg)

    def after_agent(self, state, runtime):
        if self.hook == "after_agent":
            self._maybe()

    async def aafter_agent(self, state, runtime):
        self.after_agent(state, runtime)

    def after_model(self, state, runtime):
        if self.hook == "after_model":
            self._maybe()

    async def aafter_model(self, state, runtime):
        self.after_model(state, runtime)


class CallTwice(AgentMiddleware):
    def wrap_model_call(self, request, handler):
        handler(request)
        return handler(request)

    async def awrap_model_call(self, request, handler):
        await handler(request)
        return await handler(request)


class CommandWriter(AgentMiddleware):
    def __init__(self, update):
        self.update = update

    def wrap_model_call(self, request, handler):
        return ExtendedModelResponse(
            model_response=handler(request), command=Command(update=self.update)
        )

    async def awrap_model_call(self, request, handler):
        return ExtendedModelResponse(
            model_response=await handler(request), command=Command(update=self.update)
        )


class Mutator(ChessMiddleware):
    def before_model(self, state, runtime):
        state["moves"].append("a2a3")
        state["allowed_moves"].clear()
        state["turns"][-1]["status"] = "committed"

    async def abefore_model(self, state, runtime):
        self.before_model(state, runtime)


async def test_compatible_pruners_replay_without_widening(make_agent, run, cfg):
    model = ScriptedModel(script=["MOVE: d4", "MOVE: e4"])
    agent = make_agent(model, middleware=[Pruner("A", ["e2e4", "d2d4"]), Pruner("B", ["e2e4"])])
    out = await run(agent, position(restrict=["e2e4", "d2d4", "g1f3"]), cfg)
    assert out["moves"] == ["e2e4"]
    assert "Only these moves are permitted: e4." in model.requests[1][-1].content


async def test_disjoint_restrictions_fail_before_the_model(make_agent, run, cfg):
    model = ScriptedModel(script=["MOVE: e4"])
    agent = make_agent(model, middleware=[Pruner("A", ["e2e4"]), Pruner("B", ["d2d4"])])
    with pytest.raises(ChessContractError, match="B wrote `allowed_moves`: the narrowing leaves"):
        await run(agent, position(), cfg)
    assert model.calls == 0


async def test_writing_moves_is_a_violation_and_writes_nothing(make_agent, run, cfg):
    agent = make_agent(ScriptedModel(script=[]), middleware=[Writes({"moves": ["e2e4"]})])
    with pytest.raises(ChessContractError, match="Writes wrote `moves`: core-owned"):
        await run(agent, position(), cfg)
    assert agent.get_state(cfg).values["moves"] == []


async def test_in_place_mutation_has_no_effect(make_agent, run, cfg):
    agent = make_agent(ScriptedModel(script=["MOVE: e4"]), middleware=[Mutator()])
    out = await run(agent, position(), cfg)
    assert out["moves"] == ["e2e4"]
    assert out["turns"][0]["initial_allowed"][0] == "g1h3"


async def test_a_wrapper_command_may_not_write_chess_state(make_agent, run, cfg):
    agent = make_agent(
        ScriptedModel(script=["MOVE: e4"]), middleware=[CommandWriter({"candidates": ["e2e4"]})]
    )
    with pytest.raises(ChessContractError, match="own keys"):
        await run(agent, position(), cfg)


def test_redeclared_or_unmarked_keys_fail_construction():
    class Redeclares(ChessState):
        moves: NotRequired[list[str]]

    class Unmarked(ChessState):
        note: NotRequired[str]

    for schema in (Redeclares, Unmarked):
        middleware = type("M", (ChessMiddleware,), {"state_schema": schema})()
        with pytest.raises(ChessContractError, match="the input schema exposes"):
            create_chess_agent(ScriptedModel(script=[]), middleware=[middleware])


def test_two_extensions_declaring_one_key_fail_construction():
    with pytest.raises(ChessContractError, match="`proposer_note` is declared by both"):
        create_chess_agent(ScriptedModel(script=[]), middleware=[Proposer(), CustomNamed()])


def test_tools_are_refused():
    @tool
    def helper() -> str:
        """Help."""
        return ""

    middleware = AgentMiddleware()
    middleware.tools = [helper]
    with pytest.raises(ChessContractError, match="registers tools"):
        create_chess_agent(ScriptedModel(script=[]), middleware=[middleware])


def test_a_middleware_is_shared_only_by_agents_with_one_seed():
    shared = Proposer()
    create_chess_agent(None, middleware=[shared], seed=1)
    create_chess_agent(None, middleware=[shared], seed=1)
    with pytest.raises(ChessContractError, match="already bound to seed 1"):
        create_chess_agent(None, middleware=[shared], seed=2)
    assert shared.agent_seed == 1


def test_sync_function_as_async_hook_is_refused():
    class Bad(AgentMiddleware):
        def abefore_model(self, state, runtime):  # not a coroutine function
            return None

    with pytest.raises(ChessContractError, match="must be a coroutine function"):
        guard(Bad())


async def test_two_candidate_writers_in_one_turn(make_agent, run, cfg):
    first = Writes({"candidates": ["e2e4"]}, label="First")
    second = Writes({"candidates": ["d2d4"]}, label="Second")
    agent = make_agent(ScriptedModel(script=[]), middleware=[first, second])
    with pytest.raises(ChessContractError, match="Second wrote `candidates`: First already"):
        await run(agent, position(), cfg)


async def test_the_same_writer_may_rewrite_candidates_on_replay(make_agent, run, cfg):
    model = ScriptedModel(script=["MOVE: Qh5", "MOVE: e4"])
    agent = make_agent(model, middleware=[Writes({"candidates": ["e2e4", "d2d4"]})])
    out = await run(agent, position(), cfg)
    assert out["moves"] == ["e2e4"]
    assert "Suggested candidates: e4, d4." in model.requests[1][-1].content


@pytest.mark.parametrize(
    ("update", "match"),
    [
        ({"candidates": ["e2e4", "e2e4"]}, "duplicate-free"),
        ({"candidates": ["e2e5"]}, "duplicate-free"),
        ({"fallback_move": "e2e5"}, "not an allowed move"),
        ({"proposal": {"uci": "e2e5", "source": "x"}}, "not an allowed move"),
        ({"proposal": {"uci": "e2e4"}}, "must be a Proposal"),
        ({"proposal": "e2e4"}, "must be a Proposal"),
        ({"proposal": {"uci": "e2e4", "source": "x", "analysis": 1}}, "must be a Proposal"),
        ({"proposal": {"uci": "e2e4", "source": "x", "meta": []}}, "must be a Proposal"),
        ({"proposal": {"uci": "e2e4", "source": "x", "meta": {"v": object()}}}, "a Proposal"),
        ({"proposal": {"uci": "e2e4", "source": "x", "meta": {"v": [{1: "k"}]}}}, "a Proposal"),
        ({"proposal": {"uci": "e2e4", "source": "x", "by": "y"}}, "must be a Proposal"),
        ({"allowed_moves": ["e2e4", "e2e5"]}, "may only narrow"),
        ({"note": 1}, "not declared in its state_schema"),
        ("text", "updates must be dicts"),
        (Command(goto="model"), "only Command"),
        (
            {"allowed_moves": ["d2d4"], "proposal": {"uci": "e2e4", "source": "x"}},
            "not an allowed move",
        ),
    ],
)
async def test_guard_rules(make_agent, run, cfg, update, match):
    agent = make_agent(ScriptedModel(script=[]), middleware=[Writes(update)])
    with pytest.raises(ChessContractError, match=match):
        await run(agent, position(), cfg)


async def test_command_updates_and_valid_writes_pass(make_agent, run, cfg):
    update = Command(update={"allowed_moves": ["e2e4", "d2d4"], "fallback_move": "d2d4"})
    model = ScriptedModel(script=["MOVE: e4"])
    out = await run(make_agent(model, middleware=[Writes(update)]), position(), cfg)
    assert out["moves"] == ["e2e4"]


async def test_a_second_proposal_is_refused(make_agent, run, cfg):
    agent = make_agent(
        ScriptedModel(script=[]), middleware=[Proposer(), Writes(Proposer().propose("e2e4"))]
    )
    # The first proposer jumps to the end, so the second never runs...
    out = await run(agent, position(), cfg)
    assert out["moves"] == ["d2d4"]
    # ...but a proposal written while one exists is refused.
    again = Writes(lambda state: {"proposal": {"uci": "e2e4", "source": "x"}}, label="Again")
    agent = make_agent(
        ScriptedModel(script=[]),
        middleware=[Writes({"proposal": {"uci": "d2d4", "source": "a"}}, label="A"), again],
    )
    with pytest.raises(ChessContractError, match="a proposal already exists"):
        await run(agent, position(), cfg)


@pytest.mark.parametrize("proposer", [Proposer, InheritedProposer, CustomNamed])
async def test_guarded_proposers(make_agent, run, cfg, proposer):
    instance = proposer()
    agent = make_agent(None, middleware=[instance])
    assert f"{instance.name}.before_model" in agent.get_graph().nodes
    out = await run(agent, position(), cfg)
    ply = out["plies"][0]
    assert (ply["uci"], ply["source"], ply["model"]) == ("d2d4", instance.name, "book")
    assert ply["meta"][instance.name]["note"] == "played"
    assert ply["meta"][instance.name]["board"].startswith("rnbqkbnr/pppppppp/8/8/8/8/")
    assert out["messages"][-1].content == "MOVE: d4"


async def test_async_only_proposer(make_agent, cfg):
    agent = make_agent(None, middleware=[AsyncOnlyProposer()])
    out = await agent.ainvoke(position(), cfg)
    assert (out["plies"][0]["source"], out["plies"][0]["analysis"]) == ("asyncbook", "book move")


async def test_no_model_is_never_called_after_a_proposal(make_agent, run, cfg):
    out = await run(make_agent(None, middleware=[Proposer()]), position(), cfg)
    assert out["turns"][0]["calls"] == []


async def test_no_model_fails_loudly(make_agent, run, cfg):
    with pytest.raises(ChessContractError, match="no model is configured"):
        await run(make_agent(None), position(), cfg)


async def test_a_committed_proposal_survives_a_failing_after_agent(make_agent, run, cfg):
    model = ScriptedModel(script=["MOVE: e4"])
    agent = make_agent(model, middleware=[RaiseOnce("after_agent")])
    with pytest.raises(RuntimeError, match="after_agent failed"):
        await run(agent, position(), cfg)
    assert agent.get_state(cfg).values["proposal"]["uci"] == "e2e4"
    out = await run(agent, {}, cfg)
    assert out["moves"] == ["e2e4"]
    assert model.calls == 1


async def test_a_resignation_survives_a_failing_after_agent(make_agent, run, cfg):
    model = ScriptedModel(script=["MOVE: Qh5"] * 4)
    agent = make_agent(model, middleware=[RaiseOnce("after_agent")])
    with pytest.raises(RuntimeError):
        await run(agent, position(), cfg)
    values = agent.get_state(cfg).values
    assert values["outcome"] is None
    assert values["turns"][-1]["status"] == "pending"
    out = await run(agent, {}, cfg)
    assert out["outcome"]["kind"] == "resignation"
    assert model.calls == 4


async def test_the_reply_survives_a_failing_after_model(make_agent, run, cfg):
    model = ScriptedModel(script=["MOVE: e4"])
    agent = make_agent(model, middleware=[RaiseOnce("after_model")])
    with pytest.raises(RuntimeError, match="after_model failed"):
        await run(agent, position(), cfg)
    values = agent.get_state(cfg).values
    assert values["messages"][-1].content == "MOVE: e4"
    assert len(values["turns"][-1]["calls"]) == 1


async def test_resuming_after_a_failing_after_model_plays_the_saved_reply(make_agent, run, cfg):
    model = ScriptedModel(script=["MOVE: e4", "MOVE: d4"])
    agent = make_agent(model, middleware=[RaiseOnce("after_model")])
    with pytest.raises(RuntimeError, match="after_model failed"):
        await run(agent, position(), cfg)
    out = await run(agent, None, cfg)
    assert out["moves"] == ["e2e4"]
    assert model.calls == 1
    assert out["turns"][-1]["status"] == "committed"
    assert len(out["turns"][-1]["calls"]) == 1


async def test_an_empty_retry_after_a_failing_after_model_asks_the_model_again(
    make_agent, run, cfg
):
    model = ScriptedModel(script=["MOVE: e4", "MOVE: d4"])
    agent = make_agent(model, middleware=[RaiseOnce("after_model")])
    with pytest.raises(RuntimeError, match="after_model failed"):
        await run(agent, position(), cfg)
    out = await run(agent, {}, cfg)
    assert out["moves"] == ["d2d4"]
    assert model.calls == 2
    assert len(out["turns"][-1]["calls"]) == 2


@pytest.mark.parametrize("traced", [False, True])
async def test_inner_double_calls_are_recorded_once_each(make_agent, run, cfg, traced):
    model = ScriptedModel(script=["MOVE: d4", "MOVE: e4"])
    agent = make_agent(model, middleware=[CallTwice()])
    with tracing_context(enabled="local" if traced else False):
        out = await run(agent, position(), cfg)
    assert out["moves"] == ["e2e4"]
    assert len(out["turns"][0]["calls"]) == 2
    assert [m.content for m in out["messages"] if isinstance(m, AIMessage)] == ["MOVE: e4"]


async def test_calls_before_a_wrapper_failure_are_kept_and_retried_once(make_agent, run, cfg):
    model = ScriptedModel(script=["MOVE: d4", RuntimeError("down"), "MOVE: c4", "MOVE: e4"])
    agent = make_agent(model, middleware=[CallTwice()])
    with pytest.raises(RuntimeError, match="down"):
        await run(agent, position(), cfg)
    values = agent.get_state(cfg).values
    assert len(values["turns"][-1]["calls"]) == 1
    assert values["failed_call"]["error"] == "RuntimeError: down"
    out = await run(agent, {}, cfg)
    assert out["moves"] == ["e2e4"]
    calls = out["turns"][-1]["calls"]
    assert len(calls) == 3
    assert turn_cost(calls) == {"usd": pytest.approx(3 * calls[0]["cost_usd"]), "complete": True}
    assert agent.get_state(cfg).values["failed_call"] is None


async def test_resuming_after_a_wrapper_failure_calls_the_model_again(make_agent, run, cfg):
    model = ScriptedModel(script=["MOVE: d4", RuntimeError("down"), "MOVE: c4", "MOVE: e4"])
    agent = make_agent(model, middleware=[CallTwice()])
    with pytest.raises(RuntimeError, match="down"):
        await run(agent, position(), cfg)
    out = await run(agent, None, cfg)
    assert out["moves"] == ["e2e4"]
    assert len(out["turns"][-1]["calls"]) == 3
    assert out["turns"][-1]["illegal_attempts"] == 0


async def test_an_overflow_after_a_completed_call_is_still_a_budget_error(make_agent, run, cfg):
    model = ScriptedModel(script=["MOVE: d4", RuntimeError("prompt is too long")])
    agent = make_agent(model, middleware=[CallTwice()])
    with pytest.raises(ContextBudgetError):
        await run(agent, position(), cfg)
    assert len(agent.get_state(cfg).values["turns"][-1]["calls"]) == 1


async def test_retry_middleware_calls_are_recorded(make_agent, run, cfg):
    model = ScriptedModel(script=[RuntimeError("flaky"), "MOVE: e4"])
    agent = make_agent(model, middleware=[ModelRetryMiddleware(max_retries=1, initial_delay=0)])
    out = await run(agent, position(), cfg)
    assert out["moves"] == ["e2e4"]
    assert len(out["turns"][0]["calls"]) == 1


def stall() -> StreamChunkTimeoutError:
    return StreamChunkTimeoutError(120.0, model_name="glm", chunks_received=2)


async def test_a_stalled_stream_is_retried_within_the_turn(make_agent, run, cfg):
    model = ScriptedModel(script=[stall(), "MOVE: e4"])
    agent = make_agent(model)
    out = await run(agent, position(), cfg)
    assert out["moves"] == ["e2e4"]
    assert model.calls == 2
    assert len(out["turns"][0]["calls"]) == 1
    assert out["turns"][0]["illegal_attempts"] == 0
    assert agent.config["callbacks"][0].pending == 0


async def test_a_second_stall_fails_the_turn_and_retry_resumes_it(make_agent, run, cfg):
    model = ScriptedModel(script=[stall(), stall(), "MOVE: e4"])
    agent = make_agent(model)
    with pytest.raises(StreamChunkTimeoutError):
        await run(agent, position(), cfg)
    out = await run(agent, None, cfg)
    assert out["moves"] == ["e2e4"]
    assert len(out["turns"]) == 1


async def test_only_a_stall_is_retried(make_agent, run, cfg):
    model = ScriptedModel(script=[TimeoutError("read timed out"), "MOVE: e4"])
    with pytest.raises(TimeoutError, match="read timed out"):
        await run(make_agent(model), position(), cfg)
    assert model.calls == 1


def test_without_langchain_openai_nothing_is_a_stall(monkeypatch):
    monkeypatch.setitem(sys.modules, "langchain_openai", None)
    assert stall_errors() == ()


def test_stall_retry_adds_no_node(make_agent):
    nodes, _, _ = topology(make_agent(ScriptedModel(script=[])))
    assert not any("StallRetry" in node for node in nodes)


async def test_concurrent_async_threads_keep_their_own_calls(make_agent):
    model = ScriptedModel(script=["MOVE: e4", "MOVE: e4"], delay=0.05)
    agent = make_agent(model)
    configs = [{"configurable": {"thread_id": f"c{i}"}} for i in range(2)]
    outs = await asyncio.gather(*(agent.ainvoke(position(), c) for c in configs))
    assert [len(o["turns"][0]["calls"]) for o in outs] == [1, 1]
    assert _SINK.get() is None
    assert agent.config["callbacks"][0].pending == 0


def test_concurrent_sync_threads_keep_their_own_calls(make_agent):
    agent = make_agent(ScriptedModel(script=["MOVE: e4"] * 4))
    configs = [{"configurable": {"thread_id": f"s{i}"}} for i in range(4)]
    with ThreadPoolExecutor(4) as pool:
        outs = list(pool.map(lambda c: agent.invoke(position(), c), configs))
    assert [len(o["turns"][0]["calls"]) for o in outs] == [1, 1, 1, 1]


async def test_a_jump_without_a_decision_is_a_contract_error(make_agent, run, cfg):
    class Skips(ChessMiddleware):
        @hook_config(can_jump_to=["end"])
        def before_model(self, state, runtime):
            return {"jump_to": "end"}

        @hook_config(can_jump_to=["end"])
        async def abefore_model(self, state, runtime):
            return {"jump_to": "end"}

    with pytest.raises(ChessContractError, match="without a move or an outcome"):
        await run(make_agent(None, middleware=[Skips()]), position(), cfg)


async def test_a_proposal_narrowed_away_fails_at_commit(make_agent, run, cfg):
    class NarrowsLate(ChessMiddleware):
        def after_agent(self, state, runtime):
            return {"allowed_moves": ["d2d4"]}

        async def aafter_agent(self, state, runtime):
            return self.after_agent(state, runtime)

    agent = make_agent(ScriptedModel(script=["MOVE: e4"]), middleware=[NarrowsLate()])
    with pytest.raises(ChessContractError, match="proposal e2e4 from llm is not an allowed move"):
        await run(agent, position(), cfg)


async def test_plain_agent_middleware_without_chess_hooks(make_agent, run, cfg):
    out = await run(
        make_agent(ScriptedModel(script=["MOVE: e5"]), middleware=[AgentMiddleware()]),
        human("e4"),
        cfg,
    )
    assert out["moves"] == ["e2e4", "e7e5"]


def test_position_view_and_helpers():
    middleware = Pruner("P", ["e2e4"])
    state = {
        "start_fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        "moves": ["e2e4"],
        "allowed_moves": ["e7e5", "c7c5"],
        "candidates": ["c7c5"],
        "turns": [{"id": "t", "initial_allowed": ["e7e5", "c7c5", "d7d5"]}],
    }
    view = middleware.position(state)
    assert view.candidates == ("c7c5",)
    assert view.board().move_stack[0].uci() == "e2e4"
    assert middleware.narrow(state, ["c7c5", "a7a6"]) == {"allowed_moves": ["c7c5"]}
    assert middleware.ply_meta(state) is None
    assert middleware.turn_calls(state) == []
    assert middleware.position({**state, "candidates": None}).candidates is None
    assert middleware.propose("e7e5") == {
        "proposal": {"uci": "e7e5", "source": "P"},
        "jump_to": "end",
    }


def test_model_response_passthrough_is_unchecked():
    class Passes(AgentMiddleware):
        def wrap_model_call(self, request, handler):
            return ModelResponse(result=[AIMessage("MOVE: e4")])

    proxy = guard(Passes())
    assert proxy.name == "Passes"
