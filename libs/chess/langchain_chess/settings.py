"""`CoreSettings`: the settings of the agent's core, what the LLM is and what it reads.

`langchain_chess_systemone.settings.ChessContext` adds System 1's and makes the settings file.
"""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from langchain_chess.rules import DrawClaims

type ReasoningEffort = Literal["low", "medium", "high"]
type ListedMoves = Literal["both", "legal", "candidates", "none"]

DEFAULT_MODEL = "langsmith:baseten/zai-org/GLM-5.3-Flash"


def setting(
    description: str,
    *nodes: str,
    gt: float | None = None,
    ge: float | None = None,
    le: float | None = None,
    min_length: int | None = None,
) -> Any:
    """`langgraph_nodes` tells Studio which nodes a setting affects, so it highlights them."""
    return Field(
        description=description,
        json_schema_extra={"langgraph_nodes": list(nodes)},
        gt=gt,
        ge=ge,
        le=le,
        min_length=min_length,
    )


class Settings(BaseModel):
    # Strict: the web app's checks are generated from the schema, and JavaScript has no "5" == 5.
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class CoreSettings(Settings):
    model: Annotated[
        str,
        setting(
            "init_chat_model spec: `langsmith:<provider>/<model>` for the LLM Gateway, "
            "or `provider:model` and bare names with that provider's package installed.",
            "model",
            min_length=1,
        ),
    ] = DEFAULT_MODEL
    reasoning_effort: Annotated[
        ReasoningEffort | None,
        setting(
            "Reasoning effort passed to the model. Null sends none and uses the model's own "
            "default; models without reasoning (such as Claude Haiku 4.5) need it null.",
            "model",
        ),
    ] = None
    move_list: Annotated[
        ListedMoves,
        setting(
            "The moves listed in each turn's message. `both`: System 1's candidates, when there "
            "are any, and every legal move. `legal`: every legal move. `candidates`: only the "
            "candidates. `none`: no list. A restricted turn always lists the permitted moves.",
            "model",
        ),
    ] = "both"
    memory: Annotated[
        bool,
        setting(
            "Keep earlier turns, summarized at 70% of the model's input limit. Needs a model "
            "with a known input limit. Ignored when the LLM doesn't play.",
            "model",
        ),
    ] = False
    draw_claims: Annotated[
        DrawClaims,
        setting(
            "`auto` ends the game on a threefold repetition or the fifty-move rule; `never` "
            "plays on until a draw is forced.",
            "model",
        ),
    ] = "auto"
