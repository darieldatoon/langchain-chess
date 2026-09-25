"""Model names. Pure, no dependencies."""

GATEWAY_PREFIX = "langsmith:"


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
