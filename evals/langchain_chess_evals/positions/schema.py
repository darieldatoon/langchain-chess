"""JSON Schemas for the positions dataset's inputs and reference outputs. Pure.

LangSmith validates every example written to a dataset against them, so a malformed row fails
at upload rather than in an experiment. Metadata has no schema in LangSmith.
"""

from typing import Any

UCI_PATTERN = "^[a-h][1-8][a-h][1-8][qrbn]?$"
_UCI: dict[str, Any] = {"type": "string", "pattern": UCI_PATTERN}

INPUTS_SCHEMA: dict[str, Any] = {
    "title": "Position",
    "description": "A position from a Lichess game, in RankRequest's shape less the seed.",
    "type": "object",
    "properties": {
        "start_fen": {
            "type": "string",
            "description": "The game's starting position (FEN): always the standard start.",
        },
        "moves": {
            "type": "array",
            "items": _UCI,
            "description": "Every move played so far, in UCI, from the start.",
        },
        "legal": {
            "type": "array",
            "items": _UCI,
            "minItems": 1,
            "uniqueItems": True,
            "description": "Every legal move in the position: the options to rank.",
        },
    },
    "required": ["start_fen", "moves", "legal"],
    "additionalProperties": False,
}

_EVAL: dict[str, Any] = {
    "oneOf": [
        {
            "type": "object",
            "properties": {"cp": {"type": "integer", "description": "Centipawns, White's side."}},
            "required": ["cp"],
            "additionalProperties": False,
        },
        {
            "type": "object",
            "properties": {
                "mate": {"type": "integer", "minimum": 0, "description": "Moves to mate."},
                "winner": {"enum": ["white", "black"]},
            },
            "required": ["mate", "winner"],
            "additionalProperties": False,
        },
    ]
}

OUTPUTS_SCHEMA: dict[str, Any] = {
    "title": "Engine labels",
    "description": "Stockfish's evaluation of every legal move.",
    "type": "object",
    "properties": {
        "evals": {
            "type": "object",
            "propertyNames": {"pattern": UCI_PATTERN},
            "additionalProperties": _EVAL,
            "minProperties": 1,
            "description": "Every legal move's eval, from White's side. Key order carries no "
            "meaning: read the order from `ranked`.",
        },
        "ranked": {
            "type": "array",
            "items": _UCI,
            "minItems": 1,
            "uniqueItems": True,
            "description": "Every legal move in the engine's order, best first.",
        },
        "best": {**_UCI, "description": "The engine's best move: ranked[0]."},
        "top3": {
            "type": "array",
            "items": _UCI,
            "minItems": 1,
            "maxItems": 3,
            "description": "The engine's top three moves: ranked[:3].",
        },
    },
    "required": ["evals", "ranked", "best", "top3"],
    "additionalProperties": False,
}
