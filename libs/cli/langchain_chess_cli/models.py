"""Chat-model construction for the CLI.

The CLI is distributable and enforces no org rules: langchain-core's gateway resolution and the
provider's own environment supply credentials.
"""

from typing import Any

from langchain.chat_models import init_chat_model
from langchain_core.language_models.chat_models import BaseChatModel

from langchain_chess.models import GATEWAY_PREFIX, model_identity

MAX_TOKENS = 32000
"""The output cap covers reasoning too; keep it well above any reasoning budget."""

# The gateway's ChatOpenAI has no profile, and a fractional summarization trigger needs one.
# Native providers ship full profiles; never replace them with these.
PROFILES: dict[str, dict[str, Any]] = {
    "claude-opus-5": {"max_input_tokens": 1_000_000},
    "claude-opus-5-5": {"max_input_tokens": 1_000_000},
}


def chat_model(model: str, reasoning_effort: str) -> BaseChatModel:
    name = model_identity(model)[1]
    kwargs: dict[str, Any] = {
        "reasoning_effort": reasoning_effort,
        "max_tokens": MAX_TOKENS,
        # The trace span's name; through the gateway every vendor would read as `ChatOpenAI`.
        "name": name,
    }
    if model.startswith(GATEWAY_PREFIX) and (profile := PROFILES.get(name)):
        kwargs["profile"] = profile
    return init_chat_model(model, **kwargs)
