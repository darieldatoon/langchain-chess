"""`ChessContext`: every setting of a game's opponent, and the versioned settings file.

A settings file is `ChessContext` as JSON. Every schema change bumps `VERSION`: a key added,
renamed or removed, a default changed, or a value's meaning changed. `DEFAULTS` freezes each
version's keys and defaults, and `MIGRATIONS` carries a version's keys to the next one.
"""

from collections.abc import Callable, Mapping
from types import MappingProxyType
from typing import Annotated, Any, Literal, TypedDict, cast

from pydantic import BeforeValidator, Field

from langchain_chess.settings import CoreSettings, Settings, setting
from langchain_chess.state import JSONValue
from langchain_chess_systemone.describe import DescriptionStyle
from langchain_chess_systemone.ranker import CHOICE_LIMIT
from langchain_chess_systemone.types import Gate

type Policy = Literal["llm", "systemone", "hybrid"]

VERSION = 1
MAX_SEED = 2**53 - 1
"""The largest integer a browser's JSON keeps exactly."""

_SYSTEMONE = "SystemOneMiddleware.before_model"


def _integral(value: object) -> object:
    """JSON can't tell 5.0 from 5, and a browser reads both as 5: so neither may this."""
    return int(value) if isinstance(value, float) and value.is_integer() else value


class SystemOneSettings(Settings):
    systemone_model: Annotated[
        str,
        setting(
            "System 1 model: `semif-qwen3.5-4b` (SemIf) or `typesafe/jev-latest` (Jev). Another "
            "TypeSafe classifier works too, with a conservative cap on the moves per request.",
            _SYSTEMONE,
            min_length=1,
        ),
    ] = "semif-qwen3.5-4b"
    style: Annotated[
        DescriptionStyle,
        setting(
            "How each legal move is described to System 1. `rich` adds captures, checks and "
            "exchange results; `terse` names the move only.",
            _SYSTEMONE,
        ),
    ] = "rich"
    with_eval: Annotated[
        bool,
        setting(
            "Also ask System 1 to score the position. Recorded only; it doesn't change the move.",
            _SYSTEMONE,
        ),
    ] = False
    with_nouls: Annotated[
        bool,
        setting(
            "Also ask System 1 whether the position needs calculation and has tactics. Recorded "
            "only; it doesn't change the move.",
            _SYSTEMONE,
        ),
    ] = False
    gate: Annotated[
        Gate,
        setting(
            "The signal compared with the threshold. `margin`: the top move's probability minus "
            "the second's. `confidence`: System 1's own confidence in its ranking.",
            _SYSTEMONE,
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
        ),
    ] = None
    k: Annotated[
        int,
        setting("The most candidates suggested to the LLM.", _SYSTEMONE, ge=1, le=CHOICE_LIMIT),
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
        ),
    ] = None
    seed: Annotated[
        int,
        setting("Seeds System 1's tournament shuffle.", _SYSTEMONE, ge=-MAX_SEED, le=MAX_SEED),
        BeforeValidator(_integral),
    ] = 0


class _Head(Settings):
    version: Annotated[Literal[1], Field(description="The settings file's version.")] = VERSION
    policy: Annotated[
        Policy,
        setting(
            "Who chooses moves. `llm`: the LLM alone. `systemone`: System 1 alone. `hybrid`: "
            "System 1 plays the moves it is confident about and suggests candidates otherwise.",
            _SYSTEMONE,
            "model",
        ),
    ] = "hybrid"


class ChessContext(SystemOneSettings, CoreSettings, _Head):
    """A game's opponent. `move_list`, `memory` and `reasoning_effort` affect only the LLM."""


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
    }
)
"""Each version's keys and defaults, frozen: never edit a released version's entry."""

LEGACY_KEYS = frozenset(
    {
        "policy",
        "model",
        "reasoning_effort",
        "show_legal_moves",
        "memory",
        "systemone_model",
        "style",
        "with_eval",
        "with_nouls",
        "gate",
        "threshold",
        "tournament_threshold",
        "k",
        "top_p",
        "draw_claims",
        "seed",
    }
)
"""The keys of settings recorded before versions (version 0)."""

_LEGACY_MEMORY = {"none": False, "summarize": True}
_LEGACY_LEGAL_MOVES = {True: "both", False: "candidates"}


def from_legacy(values: dict[str, Any]) -> dict[str, Any]:
    """Both conversions keep exactly what the model saw."""
    if isinstance(memory := values.get("memory"), str) and memory in _LEGACY_MEMORY:
        values = {**values, "memory": _LEGACY_MEMORY[memory]}
    if "show_legal_moves" not in values:
        return values
    values = dict(values)
    shown = values.pop("show_legal_moves")
    if "move_list" in values:
        msg = "set move_list or the older show_legal_moves, not both"
        raise SettingsError(msg)
    if shown is None:
        return values
    if not isinstance(shown, bool):
        msg = f"show_legal_moves must be true or false, got {shown!r}"
        raise SettingsError(msg)
    return {**values, "move_list": _LEGACY_LEGAL_MOVES[shown]}


MIGRATIONS: Mapping[int, Callable[[dict[str, Any]], dict[str, Any]]] = MappingProxyType(
    {0: from_legacy}
)
"""Version n's keys to version n + 1's, for partial settings too: a step that changes a default
must write the old default into a partial that omits the key."""


def keys(version: int) -> frozenset[str]:
    """The keys of a version, `version` itself excluded."""
    return LEGACY_KEYS if version == 0 else frozenset(DEFAULTS[version]) - {"version"}


def version_of(data: Mapping[str, Any], *, legacy: bool) -> int:
    """0 for settings without a version, when `legacy` allows them."""
    if "version" not in data:
        if legacy:
            return 0
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
    data: Mapping[str, Any], *, legacy: bool = False, unknown: Literal["error", "drop"] = "error"
) -> dict[str, Any]:
    """The keys partial settings set, carried to the current version, `version` excluded.

    `legacy` reads settings without a version as version 0. `unknown="drop"` ignores keys the
    settings' version doesn't have, as a source that mixes in other keys needs.
    """
    version = version_of(data, legacy=legacy)
    known = keys(version)
    values = {k: v for k, v in data.items() if k != "version"}
    if extra := set(values) - known:
        if unknown == "error":
            msg = f"unknown settings for version {version}: {', '.join(sorted(extra))}"
            raise SettingsError(msg)
        values = {k: v for k, v in values.items() if k in known}
    for step in range(version, VERSION):
        values = MIGRATIONS[step](values)
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


def load_recorded(data: object) -> ChessContext:
    """Settings a game recorded: every key of its version, or it's damaged. A game recorded
    before versions has none and every legacy key."""
    values = _mapping(data)
    version = version_of(values, legacy=True)
    given = set(values) - {"version"}
    if given != keys(version):
        missing, extra = keys(version) - given, given - keys(version)
        msg = f"recorded settings are damaged: missing {sorted(missing)}, unknown {sorted(extra)}"
        raise SettingsError(msg)
    migrated = migrate(values, legacy=True)
    if set(migrated) != keys(VERSION):
        msg = f"recorded settings are damaged: {sorted(keys(VERSION) - set(migrated))} missing"
        raise SettingsError(msg)
    return ChessContext.model_validate(migrated)


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
