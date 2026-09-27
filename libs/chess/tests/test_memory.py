import asyncio
from collections.abc import Callable

import pytest
from langchain.agents.middleware import SummarizationMiddleware
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage

from langchain_chess import ChessContractError, create_chess_agent
from langchain_chess.middleware.summarization import CHESS_SUMMARY_PROMPT, input_limit
from langchain_chess.testing import ScriptedModel, human, position, topology, usage

PROFILE = {"max_input_tokens": 100_000}


class Responder:
    """Answers summary prompts with a summary and move requests from a script."""

    def __init__(self, moves: list[str | BaseException]) -> None:
        self.moves = list(moves)
        self.summaries = 0
        self.move_requests: list[list[BaseMessage]] = []

    def __call__(self, messages: list[BaseMessage]) -> str:
        if str(messages[0].content).startswith("Summarize this chess game"):
            self.summaries += 1
            return f"SUMMARY {self.summaries}"
        self.move_requests.append(messages)
        step = self.moves.pop(0)
        if isinstance(step, BaseException):
            raise step
        return step


def model_for(responder: Callable[[list[BaseMessage]], str], **kwargs) -> ScriptedModel:
    return ScriptedModel(script=[responder] * 200, profile=PROFILE, **kwargs)


def summarizer(model, trigger=12, keep=8):
    return SummarizationMiddleware(
        model,
        trigger=("messages", trigger),
        keep=("messages", keep),
        summary_prompt=CHESS_SUMMARY_PROMPT,
    )


def is_summary(message: BaseMessage) -> bool:
    return message.additional_kwargs.get("lc_source") == "summarization"


GAME = ["e4", "Nf3", "Bb5", "Ba4", "O-O"]
REPLIES = ["MOVE: e5", "MOVE: Nc6", "MOVE: a6", "MOVE: Nf6", "MOVE: Be7"]


async def play_ruy_lopez(agent, run, cfg):
    for move in GAME:
        out = await run(agent, human(move), cfg)
        assert out["error"] is None, out["error"]
    return out


async def test_the_current_turn_survives_a_rewrite_in_one_run(make_agent, run, cfg):
    responder = Responder([*REPLIES, "MOVE: Qh5", "MOVE: b5"])
    model = model_for(responder)
    agent = make_agent(model, memory=True, summarization=summarizer(model))
    await play_ruy_lopez(agent, run, cfg)
    out = await run(agent, human("Re1"), cfg)
    assert out["moves"][-1] == "b7b5"
    messages = out["messages"]
    assert is_summary(messages[0])
    turn = out["turns"][-1]
    ids = {m.id for m in messages}
    assert turn["opened_message_id"] in ids
    assert set(turn["rejected_message_ids"]) <= ids
    assert set(turn["feedback_message_ids"]) <= ids
    assert [c["kind"] for c in turn["calls"]] == ["llm", "summary", "llm"]
    # The retry saw the summary, the opening move, the failed attempt and its feedback.
    retry = [m.content for m in responder.move_requests[-1]]
    assert str(retry[1]).endswith("SUMMARY 1")
    assert "Re1" in retry
    assert "MOVE: Qh5" in retry
    assert str(retry[-1]).startswith("Moves so far:")
    assert messages[0].id in agent.get_state(cfg).values["consumed_message_ids"]


async def test_the_retried_turn_keeps_the_newest_attempt_after_a_rewrite(make_agent, run, cfg):
    responder = Responder(
        [
            *REPLIES,
            "MOVE: Qh5",
            "MOVE: Qh5",
            RuntimeError("down"),
            "MOVE: Kd8",
            "MOVE: b5",
        ]
    )
    model = model_for(responder)
    # The trigger only fires once the failed turn's messages pile up on the retry.
    agent = make_agent(model, memory=True, summarization=summarizer(model, trigger=17))
    await play_ruy_lopez(agent, run, cfg)
    with pytest.raises(RuntimeError):
        await run(agent, human("Re1"), cfg)
    assert responder.summaries == 0
    out = await run(agent, {}, cfg)
    assert responder.summaries >= 1
    turn = out["turns"][-1]
    assert turn["opened_message_id"] in {m.id for m in out["messages"]}
    last = [str(m.content) for m in responder.move_requests[-1]]
    assert any("SUMMARY" in text for text in last)
    assert "MOVE: Kd8" in last
    assert any("Try again" in text and "Kd8" in text for text in last)
    assert last[-1].startswith("Moves so far:")
    assert out["moves"][-1] == "b7b5"


def test_the_keep_floor_and_prompt_checks():
    model = ScriptedModel(script=[], profile=PROFILE)
    with pytest.raises(ChessContractError, match="keep must be"):
        create_chess_agent(model, memory=True, summarization=summarizer(model, keep=2))
    tokens = SummarizationMiddleware(model, trigger=("tokens", 10), keep=("tokens", 100))
    with pytest.raises(ChessContractError, match="keep must be"):
        create_chess_agent(model, memory=True, summarization=tokens)
    bad = SummarizationMiddleware(model, trigger=("messages", 20), summary_prompt="no slot")
    with pytest.raises(ChessContractError, match=r"\{messages\}"):
        create_chess_agent(model, memory=True, summarization=bad)
    with pytest.raises(ChessContractError, match="needs a model"):
        create_chess_agent(None, memory=True)
    create_chess_agent(model, memory=True, max_retries=1, summarization=summarizer(model, keep=4))


def test_the_input_limit_comes_from_the_profile():
    assert input_limit(ScriptedModel(script=[], profile=PROFILE)) == 100_000
    assert input_limit(ScriptedModel(script=[])) is None


def test_a_profileless_model_needs_an_absolute_trigger():
    with pytest.raises(ChessContractError, match="turn memory off"):
        create_chess_agent(ScriptedModel(script=[]), memory=True)
    agent = create_chess_agent(ScriptedModel(script=[], profile=PROFILE), memory=True)
    assert "SummarizationMiddleware.before_model" in agent.get_graph().nodes


async def test_a_fixed_topology_keeps_a_summarization_node_that_never_summarizes(
    make_agent, run, cfg
):
    model = model_for(Responder(REPLIES))
    off = make_agent(model, memory=False, fixed_topology=True)
    on = make_agent(model, memory=True, summarization=summarizer(model, trigger=10))
    assert topology(off) == topology(on)
    assert topology(off) != topology(make_agent(model, memory=False))
    out = await play_ruy_lopez(off, run, cfg)
    assert not any(is_summary(m) for m in out["messages"])
    assert all(c["kind"] == "llm" for turn in out["turns"] for c in turn["calls"])


async def test_a_summary_then_a_model_call(make_agent, run, cfg):
    responder = Responder([*REPLIES, "MOVE: b5"])
    model = model_for(responder)
    agent = make_agent(model, memory=True, summarization=summarizer(model, trigger=10))
    await play_ruy_lopez(agent, run, cfg)
    out = await run(agent, human("Re1"), cfg)
    kinds = [c["kind"] for c in out["turns"][-1]["calls"]]
    assert kinds == ["summary", "llm"]
    assert out["turns"][-1]["calls"][0]["model"] == "anthropic:claude-opus-5"


async def test_a_summary_then_a_failing_model_call(make_agent, run, cfg):
    responder = Responder([*REPLIES, RuntimeError("model down")])
    model = model_for(responder)
    agent = make_agent(model, memory=True, summarization=summarizer(model, trigger=10))
    await play_ruy_lopez(agent, run, cfg)
    with pytest.raises(RuntimeError, match="model down"):
        await run(agent, human("Re1"), cfg)
    values = agent.get_state(cfg).values
    assert is_summary(values["messages"][0])
    assert [c["kind"] for c in values["turns"][-1]["calls"]] == ["summary"]


async def test_concurrent_stateless_runs_record_their_own_summary():
    responder = Responder(["MOVE: Nf6", "MOVE: Nf6"])
    model = model_for(responder, delay=0.02)
    agent = create_chess_agent(model, memory=True, summarization=summarizer(model, trigger=10))
    history = []
    for index in range(5):
        history += [HumanMessage(f"note {index}", id=f"h{index}"), AIMessage("ok", id=f"a{index}")]

    async def one(tag: str):
        messages = [m.model_copy(update={"id": f"{tag}-{m.id}"}) for m in history]
        return await agent.ainvoke({"messages": messages, **position(["e2e4"])}, {})

    outs = await asyncio.gather(one("x"), one("y"))
    for out in outs:
        assert [c["kind"] for c in out["turns"][-1]["calls"]] == ["summary", "llm"]
        assert out["moves"] == ["e2e4", "g8f6"]


async def test_summarize_memory_over_several_turns_before_a_summary(make_agent, run, cfg):
    responder = Responder(["MOVE: Qh5", "MOVE: e5", "MOVE: Nc6", "MOVE: a6"])
    model = model_for(responder)
    agent = make_agent(model, memory=True)
    for move in ("e4", "Nf3", "Bb5"):
        await run(agent, human(move), cfg)
    seen = [str(m.content) for m in responder.move_requests[-1]]
    assert "MOVE: Qh5" not in seen
    assert not any(text.startswith("Try again") for text in seen)
    assert seen[1:-1] == ["e4", "MOVE: e5", "Nf3", "MOVE: Nc6", "Bb5"]
    assert responder.summaries == 0


async def test_one_hour_cache_writes_are_priced_total_plus_subset(make_agent, run, cfg):
    details = {
        "cache_read": 0,
        "cache_creation": 0,
        "ephemeral_5m_input_tokens": 100,
        "ephemeral_1h_input_tokens": 300,
    }
    model = ScriptedModel(
        script=["MOVE: e4"], usage_metadata=usage(1000, 0, input_token_details=details)
    )
    out = await run(make_agent(model), position(), cfg)
    call = out["turns"][0]["calls"][0]
    assert (call["cache_write_tokens"], call["cache_write_1h_tokens"]) == (400, 300)
    assert call["cost_usd"] == pytest.approx(0.003 + 0.000625 + 0.003)


def test_the_chess_summary_prompt_has_the_slot():
    assert "{messages}" in CHESS_SUMMARY_PROMPT
