"""`CoreSettings`: the settings of the agent's core, what the LLM is and what it reads.

`langchain_chess_systemone.settings.ChessContext` adds System 1's and makes the settings file.
"""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from langchain_chess.model_arguments import problems
from langchain_chess.rules import DrawClaims
from langchain_chess.state import JSONValue

type ReasoningEffort = Literal["low", "medium", "high"]
type ListedMoves = Literal["both", "legal", "candidates", "none"]

DEFAULT_MODEL = "langsmith:baseten/zai-org/GLM-5.3-Flash"


def setting(
    description: str,
    *nodes: str,
    label: str,
    help: str,
    gt: float | None = None,
    ge: float | None = None,
    le: float | None = None,
    min_length: int | None = None,
) -> Any:
    """`langgraph_nodes` tells Studio which nodes a setting affects, so it highlights them.

    `label` and `help` are the web app's name and tooltip for it: what it does and when to
    change it, in plain words. The description is for Studio and the CLI.
    """
    return Field(
        description=description,
        json_schema_extra={"langgraph_nodes": list(nodes), "x-label": label, "x-help": help},
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
            label="LLM",
            help="The reasoning model that thinks through the positions System 1 hands over.",
        ),
    ] = DEFAULT_MODEL
    model_kwargs: Annotated[
        dict[str, JSONValue],
        setting(
            "Extra arguments for the model's constructor, as `init_chat_model` takes them: "
            "`temperature`, `max_tokens`, `extra_body` and so on. They win over every other "
            "setting. Credentials, connections, the model name and what the agent sends are "
            "held back. An output limit set only inside `extra_body` isn't seen, so memory may "
            "summarize too late.",
            "model",
            label="Model arguments",
            help=(
                'Extra arguments for the model, as JSON, such as {"temperature": 0.2}. They win '
                "over the settings here. A token limit set only inside extra_body isn't counted, "
                "so memory can summarize too late."
            ),
        ),
    ] = {}
    reasoning_effort: Annotated[
        ReasoningEffort | None,
        setting(
            "Reasoning effort passed to the model. Null sends none and uses the model's own "
            "default; models without reasoning (such as Claude Haiku 4.5) need it null.",
            "model",
            label="Reasoning effort",
            help=(
                "How long the model thinks before it answers. Higher is slower and costs more. "
                "Leave it on the model's default for models without reasoning."
            ),
        ),
    ] = None
    system_prompt: Annotated[
        str | None,
        setting(
            "Replaces the bundled system prompt. Null keeps it. Each turn's message still "
            "ends by asking for `MOVE: <move>`; a reply without one is retried.",
            "model",
            min_length=1,
            label="System prompt",
            help=(
                "Replaces the instructions the model starts from. Leave it empty for the bundled "
                "prompt. Every turn still asks for a final MOVE line."
            ),
        ),
    ] = None
    show_fen: Annotated[
        bool,
        setting(
            "Show the position's FEN in each turn's message. The moves so far are always "
            "shown, and so is the starting FEN of a game from another position.",
            "model",
            label="Show the FEN",
            help=(
                "Include the position in FEN notation in every turn's message. Turn it off to see "
                "how the model does from the moves and the board alone."
            ),
        ),
    ] = True
    show_board: Annotated[
        bool,
        setting(
            "Show the board as text in each turn's message.",
            "model",
            label="Show the board",
            help=(
                "Include a text drawing of the board in every turn's message. The moves so far are"
                " always shown."
            ),
        ),
    ] = True
    move_list: Annotated[
        ListedMoves,
        setting(
            "The moves listed in each turn's message. `both`: System 1's candidates, when there "
            "are any, and every legal move. `legal`: every legal move. `candidates`: only the "
            "candidates. `none`: no list. A restricted turn always lists the permitted moves.",
            "model",
            label="Moves to list",
            help=(
                "Which moves every turn's message lists: System 1's candidates, all legal moves, "
                "both, or none. Fewer lists mean a shorter prompt and a harder test."
            ),
        ),
    ] = "both"
    memory: Annotated[
        bool,
        setting(
            "Keep earlier turns, summarized at 70% of the model's input limit. Needs a model "
            "with a known input limit. Ignored when the LLM doesn't play.",
            "model",
            label="Memory",
            help=(
                "Let the model see its earlier turns, summarized when the conversation gets long. "
                "Off, it sees only the current position, which is cheaper."
            ),
        ),
    ] = False
    draw_claims: Annotated[
        DrawClaims,
        setting(
            "`auto` ends the game on a threefold repetition or the fifty-move rule; `never` "
            "plays on until a draw is forced.",
            "model",
            label="Claim draws",
            help=(
                "End the game on a threefold repetition or after fifty moves without a capture or "
                "pawn move. Off, play continues until a draw is forced."
            ),
        ),
    ] = "auto"

    @field_validator("model_kwargs")
    @classmethod
    def _sendable(cls, value: dict[str, JSONValue]) -> dict[str, JSONValue]:
        """What every surface holds back; the server holds back more when it builds the model."""
        if found := problems({k: v for k, v in value.items() if v is not None}, surface="local"):
            raise ValueError("; ".join(found))
        return value
