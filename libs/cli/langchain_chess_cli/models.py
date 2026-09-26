"""Chat-model construction for the CLI.

The CLI is distributable and enforces no org rules: langchain-core's gateway resolution and the
provider's own environment supply credentials.
"""

from typing import Any

from langchain.chat_models import init_chat_model
from langchain_core.language_models.chat_models import BaseChatModel

from langchain_chess.models import GATEWAY_PREFIX, model_identity
from langchain_chess.pricing import context_window

MAX_TOKENS = 32000
"""The output cap covers reasoning too; keep it well above any reasoning budget."""


def chat_model(model: str, reasoning_effort: str | None) -> BaseChatModel:
    name = model_identity(model)[1]
    kwargs: dict[str, Any] = {
        "max_tokens": MAX_TOKENS,
        # The trace span's name; through the gateway every vendor would read as `ChatOpenAI`.
        "name": name,
    }
    # Models without reasoning reject the parameter outright, even as a default.
    if reasoning_effort is not None:
        kwargs["reasoning_effort"] = reasoning_effort
    # The gateway's ChatOpenAI has no profile, and summarize's fractional trigger needs one.
    # Native providers ship full profiles; never replace them.
    if model.startswith(GATEWAY_PREFIX) and (window := context_window(model)):
        kwargs["profile"] = {"max_input_tokens": window - MAX_TOKENS}
    return init_chat_model(model, **kwargs)
