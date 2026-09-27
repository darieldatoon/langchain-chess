"""JSON Schemas for the settings: the resolved settings, and the settings file. Pure."""

import copy
from typing import Any

from langchain_chess_systemone.settings import DEFAULTS, ChessContext


def settings_schema() -> dict[str, Any]:
    """The resolved settings: every key present, as a game records them."""
    schema = ChessContext.model_json_schema()
    schema["title"] = "ChessContext"
    schema["required"] = list(schema["properties"])
    return schema


def input_schema() -> dict[str, Any]:
    """A settings file: `version` required, every other key optional, null for its default."""
    schema = copy.deepcopy(settings_schema())
    properties = schema["properties"]
    version = properties["version"]
    for key in ("const", "default", "type", "title"):
        version.pop(key, None)
    version["enum"] = sorted(DEFAULTS)
    for name, prop in properties.items():
        if name == "version" or _admits_null(prop):
            continue
        described = {k: prop.pop(k) for k in ("description", "langgraph_nodes") if k in prop}
        default = prop.pop("default")
        properties[name] = {"anyOf": [prop, {"type": "null"}], **described, "default": default}
    schema["title"] = "Opponent"
    schema["description"] = "A game's opponent. Missing keys take their version's defaults."
    schema["required"] = ["version"]
    return schema


def _admits_null(prop: dict[str, Any]) -> bool:
    return {"type": "null"} in prop.get("anyOf", [])
