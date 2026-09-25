"""Runtime knobs for the `chess` graph.

Knobs arrive two ways: as assistant `context` (Studio, SDK) or inside `config["configurable"]`
(the web UI's submit). `resolve_context` merges both, configurable last.
"""

import types
from dataclasses import asdict, dataclass, fields, is_dataclass
from typing import Annotated, Any, Literal, Union, cast, get_args, get_origin, get_type_hints

from langchain_core.runnables import RunnableConfig
from pydantic import Field, TypeAdapter

type Policy = Literal["llm", "systemone", "hybrid"]
type ReasoningEffort = Literal["low", "medium", "high"]
type Memory = Literal["none"]


def _knob(description: str, *nodes: str) -> Any:
    """`langgraph_nodes` tells Studio which nodes a knob affects, so it highlights them."""
    return Field(description=description, json_schema_extra={"langgraph_nodes": list(nodes)})


_SYSTEMONE = "SystemOneMiddleware.before_model"


@dataclass(kw_only=True)
class ChessContext:
    policy: Annotated[
        Policy,
        _knob(
            "Who chooses moves. `llm`: the model alone. `systemone`: the System 1 model alone. "
            "`hybrid`: System 1 plays confident moves and suggests candidates otherwise.",
            _SYSTEMONE,
            "model",
        ),
    ] = "hybrid"
    model: Annotated[
        str,
        _knob(
            "init_chat_model spec. Bare names route through the LLM Gateway "
            "(`claude-opus-5`, `gpt-5.6-sol`).",
            "model",
        ),
    ] = "claude-opus-5"
    reasoning_effort: Annotated[
        ReasoningEffort, _knob("Reasoning effort passed to the model.", "model")
    ] = "medium"
    show_legal_moves: Annotated[bool, _knob("List the legal moves in the prompt.", "model")] = True
    memory: Annotated[
        Memory,
        _knob("How much of the game's conversation the model sees each turn.", "model"),
    ] = "none"
    systemone_model: Annotated[
        str,
        _knob("System 1 model: `semif-qwen3.5-4b` or `typesafe/jev-latest`.", _SYSTEMONE),
    ] = "semif-qwen3.5-4b"
    style: Annotated[
        Literal["rich", "terse"],
        _knob("How each legal move is described to System 1.", _SYSTEMONE),
    ] = "rich"
    with_eval: Annotated[
        bool, _knob("Also ask System 1 to score the position (telemetry).", _SYSTEMONE)
    ] = False
    with_nouls: Annotated[
        bool,
        _knob("Also ask whether the position needs calculation and has tactics.", _SYSTEMONE),
    ] = False
    gate: Annotated[
        Literal["margin", "confidence"],
        _knob(
            "Signal compared against the threshold: top-1 minus top-2 probability, or the "
            "Choice confidence.",
            _SYSTEMONE,
        ),
    ] = "margin"
    threshold: Annotated[
        float,
        _knob(
            "System 1 plays when the gate signal is at least this. 0 always plays; 1 never "
            "does (a pure pruner).",
            _SYSTEMONE,
        ),
    ] = 0.9
    tournament_threshold: Annotated[
        float | None,
        _knob(
            "Threshold after a tournament (more options than one System 1 request holds). "
            "Empty uses `threshold`.",
            _SYSTEMONE,
        ),
    ] = None
    k: Annotated[int, _knob("Candidates suggested to the model.", _SYSTEMONE)] = 5
    top_p: Annotated[
        float | None,
        _knob("Cut the suggestions at this probability mass instead of a fixed k.", _SYSTEMONE),
    ] = None
    draw_claims: Annotated[
        Literal["auto", "never"],
        _knob("End the game on a threefold repetition or the fifty-move rule.", "model"),
    ] = "auto"
    seed: Annotated[int, _knob("Seeds System 1's tournament shuffle.", _SYSTEMONE)] = 0
    summary_trigger_tokens: Annotated[
        int | None,
        _knob("Summarize at this many tokens, for models without a profile.", "model"),
    ] = None


def _context_values(runtime: Any) -> dict[str, Any]:
    execution = getattr(runtime, "execution_runtime", None)
    context = getattr(execution, "context", None)
    if context is None:
        return {}
    if is_dataclass(context) and not isinstance(context, type):
        return asdict(context)
    return dict(context)


def _admits_none(hint: Any) -> bool:
    if get_origin(hint) is Annotated:
        hint = get_args(hint)[0]
    return get_origin(hint) in (Union, types.UnionType) and type(None) in get_args(hint)


def resolve_context[T](
    schema: type[T], config: RunnableConfig | None = None, runtime: Any = None
) -> T:
    """Assistant context first, then keys explicitly present in `configurable`.

    An explicit None overrides a nullable knob (so a run can clear an assistant's `top_p`); an
    omitted key keeps the assistant's value. Unknown keys are dropped (the server puts its own
    keys in `configurable`); known keys are validated, so a bad value fails the run up front.
    """
    names = {f.name for f in fields(cast("Any", schema))}
    nullable = {
        name
        for name, hint in get_type_hints(schema, include_extras=True).items()
        if _admits_none(hint)
    }
    values = {k: v for k, v in _context_values(runtime).items() if k in names}
    configurable = (config or {}).get("configurable") or {}
    values.update(
        {k: v for k, v in configurable.items() if k in names and (v is not None or k in nullable)}
    )
    return TypeAdapter(schema).validate_python(values)
