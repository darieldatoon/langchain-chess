"""The opponent the New Game screen picks, and the `ChessContext` it plays. Pure.

Mirrors `apps/web/src/setup.ts` and the option names in `AdvancedSettings.tsx`, so both apps
offer the same opponents in the same words; keep them in step.
"""

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass, replace
from typing import Any, Literal

from pydantic import ValidationError

from langchain_chess.efforts import takes_effort
from langchain_chess.middleware.summarization import input_limit
from langchain_chess.rules import CommandError, DrawClaims, ending, root_board
from langchain_chess.state import Side
from langchain_chess_systemone.agent import default_model, sent
from langchain_chess_systemone.settings import ChessContext, dump

type SideChoice = Side | Literal["random"]
type Summarize = Literal["checking", "yes", "no"]
"""Whether the LLM can summarize its memory: only a model with a known input limit can."""

SYSTEM_ONE_NAMES = {"typesafe/jev-latest": "Jev", "openai/gpt-6-luna": "Luna Decisions"}

LLM_NAMES = {
    "langsmith:baseten/zai-org/GLM-5.3-Flash": "GLM-5.3 Flash",
    "langsmith:baseten/zai-org/GLM-5.3": "GLM-5.3",
    "langsmith:baseten/deepseek-ai/DeepSeek-V4-Flash-0731": "DeepSeek V4 Flash",
    "langsmith:fireworks/accounts/fireworks/models/minimax-m3": "MiniMax M3",
    "langsmith:openai/gpt-6-luna": "GPT-6 Luna",
    "langsmith:anthropic/claude-haiku-4-5-20251001": "Claude Haiku 4.5",
}
"""Inexpensive models only; anything else is a custom spec."""
CUSTOM = "custom"
NONE = "none"

PICKED = frozenset({"version", "policy", "model", "systemone_model"})
"""The keys the pickers own; the rest are the Advanced section's knobs."""
KNOB_SECTIONS: Mapping[str, tuple[str, ...]] = {
    "llm": ("system_prompt", "show_fen", "show_board", "move_list", "memory", "model_kwargs"),
    "systemone": ("style", "with_eval", "with_nouls"),
    "gate": ("gate", "threshold", "tournament_threshold", "k", "top_p"),
    "rules": ("draw_claims", "seed"),
}


@dataclass(frozen=True, slots=True)
class Setup:
    side: SideChoice
    system_one: str
    """Kept while System 1 is off, so turning it back on restores it."""
    system_one_off: bool
    llm: str
    """An `LLM_NAMES` preset, `CUSTOM` or `NONE`."""
    custom_model: str
    """Kept while another LLM is picked, so switching back to Custom restores it."""
    knobs: Mapping[str, Any]
    """Every other `ChessContext` key."""


@dataclass(frozen=True, slots=True)
class Unplayable:
    reason: str


type Matchup = ChessContext | Unplayable


@dataclass(frozen=True, slots=True)
class Sections:
    llm: bool
    systemone: bool
    gate: bool
    """Gate and shortlist knobs only matter when System 1 hands moves to an LLM."""


def knobs_of(context: ChessContext) -> dict[str, Any]:
    return {k: v for k, v in dump(context).items() if k not in PICKED}


def setup_of(context: ChessContext, side: SideChoice) -> Setup:
    preset = context.model if context.model in LLM_NAMES else None
    llm = NONE if context.policy == "systemone" else (preset or CUSTOM)
    return Setup(
        side=side,
        system_one=context.systemone_model,
        system_one_off=context.policy == "llm",
        llm=llm,
        custom_model="" if preset else context.model,
        knobs=knobs_of(context),
    )


def with_knob(setup: Setup, key: str, value: object) -> Setup:
    return replace(setup, knobs={**setup.knobs, key: value})


def model_of(setup: Setup) -> str | None:
    if setup.llm == NONE:
        return None
    return setup.custom_model.strip() if setup.llm == CUSTOM else setup.llm


def system_one_name(model: str) -> str:
    return SYSTEM_ONE_NAMES.get(model, model)


def model_name(model: str) -> str:
    return LLM_NAMES.get(model, model)


def model_limit(model: str) -> int | None:
    """The model's input limit, which memory summarizes against; None if it can't be built."""
    try:
        return input_limit(default_model(ChessContext(model=model)))
    except (ValueError, ImportError):
        return None


def matchup_of(setup: Setup, summarize: Summarize) -> Matchup:
    """The context `setup` plays, or what to fix first."""
    model = model_of(setup)
    system_one = None if setup.system_one_off else setup.system_one
    if model is None and system_one is None:
        return Unplayable("Pick a System 1, an LLM, or both.")
    if model == "":
        return Unplayable("Enter a model spec for the custom LLM.")
    policy = "llm" if system_one is None else "systemone" if model is None else "hybrid"
    knobs = dict(setup.knobs)
    takes = model is None or takes_effort(model)
    if not takes:
        knobs["reasoning_effort"] = None
    if model is not None and summarize == "no":
        knobs["memory"] = False
    try:
        context = ChessContext.model_validate(
            {
                **knobs,
                "policy": policy,
                # The agent ignores the model a policy doesn't use, but the key is required.
                "model": model or ChessContext().model,
                "systemone_model": setup.system_one,
            }
        )
    except ValidationError as e:
        where = ".".join(str(part) for part in e.errors()[0]["loc"])
        return Unplayable(f"Advanced settings: {where}: {_message(e)}")
    effort = sent(context)["reasoning_effort"]
    if model is not None and not takes and effort is not None:
        return Unplayable(
            f"{model_name(model)} doesn't take a reasoning effort; remove it from Model arguments."
        )
    if model is not None and context.memory and summarize == "checking":
        return Unplayable(f"Checking whether {model_name(model)} can summarize…")
    return context


def effort_overridden(model_kwargs: Mapping[str, Any]) -> bool:
    """Whether `model_kwargs` sets the effort, so the Reasoning effort setting doesn't apply."""
    reasoning, extra = model_kwargs.get("reasoning"), model_kwargs.get("extra_body")
    return (
        model_kwargs.get("reasoning_effort") is not None
        or (isinstance(reasoning, dict) and reasoning.get("effort") is not None)
        or (isinstance(extra, dict) and "reasoning" in extra)
    )


def matchup_line(context: ChessContext) -> str:
    """The matchup in plain words: "Jev plays confident moves; GLM-5.3 Flash decides the
    rest."."""
    system_one = system_one_name(context.systemone_model)
    llm = model_name(context.model)
    if context.policy == "hybrid":
        return f"{system_one} plays confident moves; {llm} decides the rest."
    if context.policy == "systemone":
        return f"{system_one} plays every move."
    return f"{llm} plays every move."


def opponent_label(context: ChessContext) -> str:
    """The opponent on the game screen, e.g. "Jev + GLM-5.3 · medium"."""
    system_one = system_one_name(context.systemone_model)
    effort = sent(context)["reasoning_effort"]
    llm = model_name(context.model) + (f" · {effort}" if effort else "")
    if context.policy == "hybrid":
        return f"{system_one} + {llm}"
    if context.policy == "systemone":
        return system_one
    return llm


def sections_of(setup: Setup) -> Sections:
    llm, systemone = setup.llm != NONE, not setup.system_one_off
    return Sections(llm=llm, systemone=systemone, gate=llm and systemone)


def _knob_text(value: object) -> str:
    if isinstance(value, bool):
        return "on" if value else "off"
    if isinstance(value, dict):
        return json.dumps(value, separators=(",", ":"))
    return str(value)


def changed_knobs(context: ChessContext) -> list[str]:
    """The knobs the policy uses that differ from the defaults, e.g. ["threshold 0.5", "k 3"]."""
    sections = {
        "llm": context.policy != "systemone",
        "systemone": context.policy != "llm",
        "gate": context.policy == "hybrid",
        "rules": True,
    }
    defaults, values = dump(ChessContext()), dump(context)
    keys = [key for name, on in sections.items() if on for key in KNOB_SECTIONS[name]]
    return [
        "custom system prompt"
        if key == "system_prompt"
        else f"{key.replace('_', ' ')} {_knob_text(values[key])}"
        for key in keys
        if values[key] != defaults[key]
    ]


def start_problem(text: str, draw_claims: DrawClaims) -> str | None:
    """Why `text` can't start a game; None for a position that can, or for empty text (the
    standard position). The game's draw claims decide whether a fifty-move root is over."""
    if not text.strip():
        return None
    try:
        board = root_board(text.strip())
    except CommandError as e:
        return str(e)
    if ending(board, draw_claims) is not None:
        return "This position is already over."
    return None


def knob_problem(key: str, value: object) -> str | None:
    """Why a typed knob value can't be played, checked on its own as the settings check it."""
    try:
        ChessContext.model_validate({key: value})
    except ValidationError as e:
        return _message(e)
    return None


def _message(error: ValidationError) -> str:
    return error.errors()[0]["msg"].removeprefix("Value error, ")


def resolve_side(choice: SideChoice, random: Callable[[], float]) -> Side:
    """Random is resolved once, when Play is pressed; the game keeps the colour it got."""
    if choice != "random":
        return choice
    return "white" if random() < 0.5 else "black"


def label_of(key: str) -> str:
    return _extra(key)["x-label"]


def help_of(key: str) -> str:
    return _extra(key)["x-help"]


def _extra(key: str) -> dict[str, Any]:
    extra = ChessContext.model_fields[key].json_schema_extra
    assert isinstance(extra, dict)
    return extra


EFFORTS = (
    ("Model default", None, "Sends none; needed for models without reasoning"),
    ("Low", "low", None),
    ("Medium", "medium", None),
    ("High", "high", None),
)
MEMORIES = (
    ("Off", False, "Each turn sees only the current position"),
    ("Summarize", True, "Earlier turns, summarized when they fill 70% of the model's input limit"),
)
MOVE_LISTS = (
    ("Candidates and legal moves", "both", None),
    ("Legal moves", "legal", None),
    ("Candidates", "candidates", "System 1's, when it has any"),
    ("None", "none", None),
)
DRAW_CLAIMS = (
    ("Yes", "auto", "Threefold repetition and fifty moves end the game"),
    ("No", "never", "Only forced draws end the game"),
)
STYLES = (
    ("Detailed", "rich", "Captures, checks, exchange results"),
    ("Names only", "terse", "Just the move, e.g. Nf3"),
)
GATES = (
    ("Lead over the next move", "margin", "The top move's probability minus the second's"),
    ("Its own confidence", "confidence", "System 1's confidence score"),
)
"""Each select's options as (label, value, description), as the web app words them."""
