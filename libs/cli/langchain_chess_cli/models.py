"""Chat-model construction for the CLI.

The CLI is distributable and enforces no org rules: langchain-core's gateway resolution and the
provider's own environment supply credentials.
"""

from typing import Any

from langchain.chat_models import init_chat_model
from langchain_core.language_models.chat_models import BaseChatModel

from langchain_chess import resolve_model_spec
from langchain_chess.models import model_identity

MAX_TOKENS = 32000
"""The output cap covers reasoning too; keep it well above any reasoning budget."""

# The gateway's ChatOpenAI has no profile, and a fractional summarization trigger needs one.
PROFILES: dict[str, dict[str, Any]] = {"claude-opus-5": {"max_input_tokens": 1_000_000}}


def chat_model(model: str, reasoning_effort: str) -> BaseChatModel:
    spec = resolve_model_spec(model)
    kwargs: dict[str, Any] = {"reasoning_effort": reasoning_effort, "max_tokens": MAX_TOKENS}
    if (profile := PROFILES.get(model_identity(spec)[1])) is not None:
        kwargs["profile"] = profile
    return init_chat_model(spec, **kwargs)
