"""Runtime knobs for the deployable graphs.

One dataclass per graph so Studio's assistant form shows only what that graph reads.
`PlayContext` is the union the `game` graph takes and maps 1:1 onto the runner's player specs,
so a Studio assistant and a `jev-chess play` spec name the same player.

Knobs arrive two ways: as assistant `context` (Studio, SDK) or inside `config["configurable"]`
(the React `useStream` submit). `resolve_context` merges both, configurable last.
"""

from dataclasses import asdict, dataclass, fields, is_dataclass
from typing import Annotated, Any, Literal, cast

from langchain_core.runnables import RunnableConfig
from pydantic import Field, TypeAdapter

from jev_chess.core import DescriptionStyle
from jev_chess.policies import (
    GateSignal,
    HybridConfig,
    JevConfig,
    LLMConfig,
    ReasoningEffort,
    resolve_model_spec,
)
from jev_chess.runner.players import HybridSpec, JevSpec, LLMSpec, PlayerSpec, RandomSpec

type PolicyKind = Literal["jev", "llm", "hybrid", "random"]
type HumanSide = Literal["white", "black"]


def _knob(description: str, *nodes: str) -> Any:
    """`langgraph_nodes` tells Studio which nodes a field affects, so it highlights them."""
    return Field(description=description, json_schema_extra={"langgraph_nodes": list(nodes)})


@dataclass(kw_only=True)
class JevKnobs:
    jev_model: Annotated[str, _knob("TypeSafe model name.", "ask_jev")] = "jev-latest"
    style: Annotated[
        DescriptionStyle,
        _knob("How each legal move is described to Jev. Rich wins on recall.", "prepare"),
    ] = "rich"
    with_eval: Annotated[
        bool, _knob("Also ask Jev for a Score of the position (telemetry only).", "prepare")
    ] = False
    with_nouls: Annotated[
        bool,
        _knob("Also ask the two Noul questions: needs calculation, tactics present.", "prepare"),
    ] = False


@dataclass(kw_only=True)
class LLMKnobs:
    model: Annotated[
        str,
        _knob(
            "init_chat_model spec. Bare names route through the LLM Gateway "
            "(`claude-opus-5`, `gpt-5.6-sol`); `openai:gpt-5.6-sol` goes direct.",
            "call_llm",
        ),
    ] = "claude-opus-5"
    reasoning_effort: Annotated[
        ReasoningEffort, _knob("Reasoning effort passed to the model.", "call_llm")
    ] = "medium"
    include_legal_moves: Annotated[
        bool,
        _knob(
            "List the legal moves in the prompt (ignored when Jev supplies a shortlist).", "prepare"
        ),
    ] = True


@dataclass(kw_only=True)
class HybridContext(JevKnobs, LLMKnobs):
    k: Annotated[int, _knob("Shortlist size handed to the LLM.", "shortlist")] = 5
    top_p: Annotated[
        float | None,
        _knob("Cut the shortlist at this probability mass instead of a fixed k.", "shortlist"),
    ] = None
    gate: Annotated[
        GateSignal,
        _knob(
            "Signal compared against the threshold: top-1 minus top-2 probability, or "
            "Choice confidence.",
            "rank_jev",
        ),
    ] = "margin"
    threshold: Annotated[
        float,
        _knob(
            "Jev plays when the gate signal is at least this. 0 = Jev alone, 1 = the LLM "
            "always chooses.",
            "rank_jev",
        ),
    ] = 0.9


@dataclass(kw_only=True)
class PlayContext(HybridContext):
    policy: Annotated[PolicyKind, _knob("Who plays against you.", "policy_move")] = "hybrid"
    human_side: Annotated[HumanSide, _knob("Your colour.", "apply_human")] = "white"
    max_plies: Annotated[
        int, _knob("Half-moves before the game is called a draw.", "policy_move")
    ] = 200


def jev_config(knobs: JevKnobs) -> JevConfig:
    return JevConfig(
        model=knobs.jev_model,
        style=knobs.style,
        with_eval=knobs.with_eval,
        with_nouls=knobs.with_nouls,
    )


def llm_config(knobs: LLMKnobs, include_legal_moves: bool | None = None) -> LLMConfig:
    return LLMConfig(
        model=resolve_model_spec(knobs.model),
        reasoning_effort=knobs.reasoning_effort,
        include_legal_moves=(
            knobs.include_legal_moves if include_legal_moves is None else include_legal_moves
        ),
    )


def hybrid_config(context: HybridContext) -> HybridConfig:
    return HybridConfig(
        jev=jev_config(context),
        llm=llm_config(context),
        k=context.k,
        top_p=context.top_p,
        gate=context.gate,
        threshold=context.threshold,
    )


def player_spec(context: PlayContext) -> PlayerSpec:
    """The runner's spec for this context, so labels match `jev-chess play` output."""
    if context.policy == "random":
        return RandomSpec()
    if context.policy == "jev":
        return JevSpec(style=context.style)
    model = resolve_model_spec(context.model)
    if context.policy == "llm":
        return LLMSpec(
            model=model,
            reasoning_effort=context.reasoning_effort,
            include_legal_moves=context.include_legal_moves,
        )
    return HybridSpec(
        model=model,
        reasoning_effort=context.reasoning_effort,
        k=context.k,
        top_p=context.top_p,
        threshold=context.threshold,
        gate=context.gate,
    )


def _context_values(runtime: Any) -> dict[str, Any]:
    execution = getattr(runtime, "execution_runtime", None)
    context = getattr(execution, "context", None)
    if context is None:
        return {}
    if is_dataclass(context) and not isinstance(context, type):
        return asdict(context)
    return dict(context)


def resolve_context[T](
    schema: type[T], config: RunnableConfig | None = None, runtime: Any = None
) -> T:
    """Merge assistant context and `configurable` into a validated `schema` instance.

    Unknown keys are dropped (the server puts its own keys in `configurable`); known keys
    are validated so a bad literal from a client fails the run instead of a node.
    """
    names = {f.name for f in fields(cast("Any", schema))}
    values = {k: v for k, v in _context_values(runtime).items() if k in names}
    configurable = (config or {}).get("configurable") or {}
    values.update({k: v for k, v in configurable.items() if k in names and v is not None})
    return TypeAdapter(schema).validate_python(values)
