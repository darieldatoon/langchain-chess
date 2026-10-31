"""`ChessContext`: every setting of a game's opponent, and the versioned settings file.

A settings file is `ChessContext` as JSON. Every schema change bumps `VERSION`: a key added,
renamed or removed, a default changed, or a value's meaning changed. `DEFAULTS` freezes each
version's keys and defaults, and `MIGRATIONS` carries a version's keys to the next one.
"""

import json
from collections.abc import Callable, Mapping
from pathlib import Path
from types import MappingProxyType
from typing import Annotated, Any, Literal, TypedDict, cast

from pydantic import BeforeValidator, Field

from langchain_chess.settings import CoreSettings, Settings, setting
from langchain_chess.state import JSONValue
from langchain_chess_systemone.describe import DescriptionStyle
from langchain_chess_systemone.ranker import CHOICE_LIMIT
from langchain_chess_systemone.types import Gate

type Policy = Literal["llm", "systemone", "hybrid"]

VERSION = 3
MAX_SEED = 2**53 - 1
"""The largest integer a browser's JSON keeps exactly."""

_SYSTEMONE = "SystemOneMiddleware.before_model"

JEV = "typesafe/jev-latest"
RETIRED_PREFIX = "semif-"
"""SemIf's models, which the gateway no longer serves."""


def _integral(value: object) -> object:
    """JSON can't tell 5.0 from 5, and a browser reads both as 5: so neither may this."""
    return int(value) if isinstance(value, float) and value.is_integer() else value


class SystemOneSettings(Settings):
    systemone_model: Annotated[
        str,
        setting(
            "System 1 model: `typesafe/jev-latest` (Jev) or `openai/gpt-6-luna` (OpenAI "
            "Decisions). Another TypeSafe classifier works too, with a conservative cap on the "
            "moves per request.",
            _SYSTEMONE,
            min_length=1,
            label="System 1",
            help="The fast move ranker. It scores every legal move in about a second.",
        ),
    ] = JEV
    style: Annotated[
        DescriptionStyle,
        setting(
            "How each legal move is described to System 1. `rich` adds captures, checks and "
            "exchange results; `terse` names the move only.",
            _SYSTEMONE,
            label="Move descriptions",
            help=(
                "How each move is described to System 1: with captures, checks and exchanges, or "
                "by name only."
            ),
        ),
    ] = "rich"
    with_eval: Annotated[
        bool,
        setting(
            "Also ask System 1 to score the position. Recorded only; it doesn't change the move.",
            _SYSTEMONE,
            label="Ask for a position score",
            help=(
                "Also ask System 1 who stands better. It's recorded on the move and doesn't change"
                " what's played."
            ),
        ),
    ] = False
    with_nouls: Annotated[
        bool,
        setting(
            "Also ask System 1 whether the position needs calculation and has tactics. Recorded "
            "only; it doesn't change the move.",
            _SYSTEMONE,
            label="Ask about tactics",
            help=(
                "Also ask System 1 whether the position needs calculation and has tactics. It's "
                "recorded on the move and doesn't change what's played."
            ),
        ),
    ] = False
    gate: Annotated[
        Gate,
        setting(
            "The signal compared with the threshold. `margin`: the top move's probability minus "
            "the second's. `confidence`: System 1's own confidence in its ranking.",
            _SYSTEMONE,
            label="Confidence measure",
            help=(
                "What System 1's confidence is judged by: how far its top move leads the next one,"
                " or its own confidence score."
            ),
        ),
    ] = "margin"
    threshold: Annotated[
        float,
        setting(
            "System 1 plays its top move when the signal is at least this; otherwise the LLM "
            "gets its candidates. 0 always plays; 1 never does.",
            _SYSTEMONE,
            ge=0.0,
            le=1.0,
            label="Bar to play alone",
            help=(
                "How confident System 1 must be to play a move without the LLM. Lower hands fewer "
                "moves to the LLM, which is faster and cheaper."
            ),
        ),
    ] = 0.9
    tournament_threshold: Annotated[
        float | None,
        setting(
            "The threshold when there were more moves than one System 1 request holds, so they "
            "were ranked in a tournament. Null uses `threshold`.",
            _SYSTEMONE,
            ge=0.0,
            le=1.0,
            label="Bar for long move lists",
            help=(
                "The same bar for positions with too many moves to rank at once, which System 1 "
                "ranks in rounds. Empty uses the bar above."
            ),
        ),
    ] = None
    k: Annotated[
        int,
        setting(
            "The most candidates suggested to the LLM.",
            _SYSTEMONE,
            ge=1,
            le=CHOICE_LIMIT,
            label="Candidates for the LLM",
            help=(
                "How many of System 1's best moves the LLM is shown when System 1 isn't sure. The "
                "LLM can still play any legal move."
            ),
        ),
        BeforeValidator(_integral),
    ] = 5
    top_p: Annotated[
        float | None,
        setting(
            "Cut the top `k` candidates further, to the fewest whose probabilities add up to at "
            "least this. Null keeps all `k`.",
            _SYSTEMONE,
            gt=0.0,
            le=1.0,
            label="Probability cutoff",
            help=(
                "Show the LLM fewer candidates when the first few already cover this much of "
                "System 1's probability. Empty always shows them all."
            ),
        ),
    ] = None
    seed: Annotated[
        int,
        setting(
            "Seeds System 1's tournament shuffle.",
            _SYSTEMONE,
            ge=-MAX_SEED,
            le=MAX_SEED,
            label="Seed",
            help=(
                "Makes System 1's rounds repeatable. Change it to replay a game with different "
                "luck."
            ),
        ),
        BeforeValidator(_integral),
    ] = 0


class _Head(Settings):
    version: Annotated[Literal[3], Field(description="The settings file's version.")] = VERSION
    policy: Annotated[
        Policy,
        setting(
            "Who chooses moves. `llm`: the LLM alone. `systemone`: System 1 alone. `hybrid`: "
            "System 1 plays the moves it is confident about and suggests candidates otherwise.",
            _SYSTEMONE,
            "model",
            label="Opponent",
            help=(
                "Who picks the moves: the LLM alone, System 1 alone, or System 1 with the LLM for "
                "the hard moves."
            ),
        ),
    ] = "hybrid"


class ChessContext(SystemOneSettings, CoreSettings, _Head):
    """A game's opponent. The settings before `systemone_model` affect only the LLM."""


class SettingsError(ValueError):
    """A settings file or source that can't be read: its shape, not a setting's value."""


DEFAULTS: Mapping[int, Mapping[str, JSONValue]] = MappingProxyType(
    {
        1: MappingProxyType(
            {
                "version": 1,
                "policy": "hybrid",
                "model": "langsmith:baseten/zai-org/GLM-5.3-Flash",
                "reasoning_effort": None,
                "move_list": "both",
                "memory": False,
                "draw_claims": "auto",
                "systemone_model": "semif-qwen3.5-4b",
                "style": "rich",
                "with_eval": False,
                "with_nouls": False,
                "gate": "margin",
                "threshold": 0.9,
                "tournament_threshold": None,
                "k": 5,
                "top_p": None,
                "seed": 0,
            }
        ),
        2: MappingProxyType(
            {
                "version": 2,
                "policy": "hybrid",
                "model": "langsmith:baseten/zai-org/GLM-5.3-Flash",
                "model_kwargs": {},
                "reasoning_effort": None,
                "system_prompt": None,
                "show_fen": True,
                "show_board": True,
                "move_list": "both",
                "memory": False,
                "draw_claims": "auto",
                "systemone_model": "semif-qwen3.5-4b",
                "style": "rich",
                "with_eval": False,
                "with_nouls": False,
                "gate": "margin",
                "threshold": 0.9,
                "tournament_threshold": None,
                "k": 5,
                "top_p": None,
                "seed": 0,
            }
        ),
        3: MappingProxyType(
            {
                "version": 3,
                "policy": "hybrid",
                "model": "langsmith:baseten/zai-org/GLM-5.3-Flash",
                "model_kwargs": {},
                "reasoning_effort": None,
                "system_prompt": None,
                "show_fen": True,
                "show_board": True,
                "move_list": "both",
                "memory": False,
                "draw_claims": "auto",
                "systemone_model": "typesafe/jev-latest",
                "style": "rich",
                "with_eval": False,
                "with_nouls": False,
                "gate": "margin",
                "threshold": 0.9,
                "tournament_threshold": None,
                "k": 5,
                "top_p": None,
                "seed": 0,
            }
        ),
    }
)
"""Each version's keys and defaults, frozen: never edit a released version's entry."""


def _adds_prompt_and_model_options(values: dict[str, Any], complete: bool) -> dict[str, Any]:
    """Version 2 only adds keys. Their defaults play as version 1 did, except that a game from
    another starting position now also shows its starting FEN."""
    if not complete:
        return values
    added = {k: DEFAULTS[2][k] for k in keys(2) - keys(1)}
    return {**added, **values}


def _retires_semif(values: dict[str, Any], complete: bool) -> dict[str, Any]:
    """Version 3 makes Jev the default: the gateway retired SemIf (#79). Settings that name a
    SemIf model play Jev, and a partial that omits the key gets Jev too, not the old default."""
    model = values.get("systemone_model")
    if isinstance(model, str) and model.startswith(RETIRED_PREFIX):
        return {**values, "systemone_model": JEV}
    return values


MIGRATIONS: Mapping[int, Callable[[dict[str, Any], bool], dict[str, Any]]] = MappingProxyType(
    {1: _adds_prompt_and_model_options, 2: _retires_semif}
)
"""Version n's keys to version n + 1's. For partial settings (`complete` false) a step writes
only what it must: an added key's default would override a source merged under this one, while
a step that changes a default must write the old default into a partial that omits the key."""


def keys(version: int) -> frozenset[str]:
    """The keys of a version, `version` itself excluded."""
    return frozenset(DEFAULTS[version]) - {"version"}


def version_of(data: Mapping[str, Any]) -> int:
    if "version" not in data:
        msg = "settings need a `version`"
        raise SettingsError(msg)
    version = _integral(data["version"])
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        msg = f"`version` must be a positive integer, got {version!r}"
        raise SettingsError(msg)
    if version > VERSION:
        msg = f"settings version {version} is newer than this reader's ({VERSION}); upgrade it"
        raise SettingsError(msg)
    return version


def migrate(
    data: Mapping[str, Any],
    *,
    unknown: Literal["error", "drop"] = "error",
    complete: bool = False,
) -> dict[str, Any]:
    """The keys partial settings set, carried to the current version, `version` excluded.

    `unknown="drop"` ignores keys the settings' version doesn't have, as a source that mixes in
    other keys needs.
    """
    version = version_of(data)
    known = keys(version)
    values = {k: v for k, v in data.items() if k != "version"}
    if extra := set(values) - known:
        if unknown == "error":
            msg = f"unknown settings for version {version}: {', '.join(sorted(extra))}"
            raise SettingsError(msg)
        values = {k: v for k, v in values.items() if k in known}
    for step in range(version, VERSION):
        values = MIGRATIONS[step](values, complete)
    return values


def resolve(*sources: Mapping[str, Any]) -> ChessContext:
    """Migrated partial settings over the defaults, later sources winning.

    An explicit null resets a key to its default: every nullable setting defaults to null.
    """
    merged: dict[str, Any] = {}
    for source in sources:
        merged |= source
    return ChessContext.model_validate({k: v for k, v in merged.items() if v is not None})


def load(data: object) -> ChessContext:
    """A settings file: `version` required, any other key optional, unknown keys an error."""
    return resolve(migrate(_mapping(data)))


def load_file(path: Path) -> ChessContext:
    """A settings file on disk, as JSON."""
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as e:
        msg = f"can't read settings from {path}: {e}"
        raise SettingsError(msg) from e
    return load(data)


def load_recorded(data: object) -> ChessContext:
    """Settings a game recorded: every key of its version, or it's damaged."""
    values = _mapping(data)
    version = version_of(values)
    given = set(values) - {"version"}
    if given != keys(version):
        missing, extra = keys(version) - given, given - keys(version)
        msg = f"recorded settings are damaged: missing {sorted(missing)}, unknown {sorted(extra)}"
        raise SettingsError(msg)
    return ChessContext.model_validate(migrate(values, complete=True))


def dump(settings: ChessContext) -> dict[str, JSONValue]:
    """Every key of the current version, as JSON: what a game records."""
    return cast("dict[str, JSONValue]", settings.model_dump(mode="json"))


def _mapping(data: object) -> Mapping[str, Any]:
    if not isinstance(data, Mapping):
        msg = f"settings must be a JSON object, got {type(data).__name__}"
        raise SettingsError(msg)
    return cast("Mapping[str, Any]", data)


def _lenient_field(name: str) -> Any:
    info = ChessContext.model_fields[name]
    field = Field(description=info.description, json_schema_extra=info.json_schema_extra)
    return Annotated[info.annotation | None, field]


_INPUT_FIELDS = {name: _lenient_field(name) for name in ChessContext.model_fields}
ChessContextInput: type = TypedDict(
    "ChessContextInput",
    _INPUT_FIELDS,  # ty: ignore[invalid-argument-type]
    total=False,
)
"""The graph's context schema: any subset of the settings, of any value. LangGraph builds the
context from it without validating, so an assistant saved by an older version still runs;
`resolve` validates what the agent reads."""
