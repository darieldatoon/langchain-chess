"""Model names. Pure, no dependencies."""

GATEWAY_PREFIX = "langsmith:"

# Bare names route through the LLM Gateway; the provider is inferred from the name, so
# `claude-opus-5` becomes `langsmith:anthropic/claude-opus-5`.
_NAME_PREFIXES: tuple[tuple[str, str], ...] = (
    ("claude", "anthropic"),
    ("gpt", "openai"),
    ("o1", "openai"),
    ("o3", "openai"),
    ("o4", "openai"),
)


def resolve_model_spec(text: str) -> str:
    """Expand a bare model name to a gateway spec; pass an explicit `provider:model` through."""
    if ":" in text:
        return text
    for prefix, provider in _NAME_PREFIXES:
        if text.startswith(prefix):
            return f"{GATEWAY_PREFIX}{provider}/{text}"
    msg = f"cannot infer a provider for {text!r}; use provider:model or langsmith:provider/model"
    raise ValueError(msg)


def model_identity(name: str, provider: str | None = None) -> tuple[str, str]:
    """(provider, model) for a spec or a callback's `ls_model_name`.

    A gateway-style `<provider>/<model>` name wins over `provider`, which for the gateway is the
    transport (`openai`), not the model's vendor.
    """
    if name.startswith(GATEWAY_PREFIX):
        name = name.removeprefix(GATEWAY_PREFIX)
    elif ":" in name:
        vendor, _, model = name.partition(":")
        return vendor, model
    if "/" in name:
        vendor, _, model = name.partition("/")
        return vendor, model
    return provider or "unknown", name


def canonical_model(name: str, provider: str | None = None) -> str:
    """`provider:model`, the form stored on every `Call`."""
    vendor, model = model_identity(name, provider)
    return f"{vendor}:{model}"
