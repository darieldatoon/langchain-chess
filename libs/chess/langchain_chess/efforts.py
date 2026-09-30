"""Which models take a reasoning effort, from a committed probe of each spec.

A spec is asked with a real call at every effort the settings offer, not looked up in a catalog:
whether an effort is taken depends on the route, and the gateway sends Baseten Anthropic's
`output_config.effort` rather than the `reasoning_effort` its own API documents. A spec that was
never probed may take an effort; if its provider rejects one, the turn fails with
`ReasoningEffortError`. A probe sees only whether the call fails: the gateway drops the effort
for GPT-4o and GPT-4.1 and answers, so they would be recorded as taking one.

`mise run probe:efforts` asks every recorded spec again, and `mise run probe:efforts -- <spec>...`
adds some. Only a web preset has to be recorded.
"""

import json
import sys
from collections.abc import Callable, Iterable
from functools import cache
from pathlib import Path
from typing import get_args

from langchain.chat_models import init_chat_model
from langchain_core.language_models.chat_models import BaseChatModel

from langchain_chess.errors import rejects_effort
from langchain_chess.settings import ReasoningEffort

SNAPSHOT = Path(__file__).with_name("efforts.json")

EFFORTS: tuple[str, ...] = get_args(ReasoningEffort.__value__)

PROBE_TOKENS = 256
"""Enough for a short reply at low effort; running out isn't an error, so it doesn't matter."""

type Build = Callable[..., BaseChatModel]


class MixedEffortsError(RuntimeError):
    """A spec took some of the offered efforts and rejected others, which one flag can't say."""


def takes_effort(model: str) -> bool:
    """False for a spec the probe found to reject a reasoning effort; True otherwise."""
    return _snapshot().get(model, True)


@cache
def _snapshot() -> dict[str, bool]:
    return json.loads(SNAPSHOT.read_text())


def probe(model: str, build: Build = init_chat_model) -> bool:
    """Whether `model` takes every effort the settings offer. Any other failure is raised."""
    taken = {
        effort: _takes(build(model, reasoning_effort=effort, max_tokens=PROBE_TOKENS))
        for effort in EFFORTS
    }
    if len(set(taken.values())) > 1:
        msg = f"{model} takes only some reasoning efforts: {taken}"
        raise MixedEffortsError(msg)
    return all(taken.values())


def _takes(model: BaseChatModel) -> bool:
    try:
        model.invoke("Reply with OK.")
    except Exception as e:
        if rejects_effort(e):
            return False
        raise
    return True


def refresh(
    added: Iterable[str], target: Path = SNAPSHOT, build: Build = init_chat_model
) -> dict[str, bool]:
    """Probes the recorded specs and `added`, and writes the snapshot only once every probe ran."""
    recorded = json.loads(target.read_text()) if target.exists() else {}
    results = {model: probe(model, build) for model in sorted({*recorded, *added})}
    target.write_text(json.dumps(results, indent=2) + "\n")
    return results


def main(argv: list[str], target: Path = SNAPSHOT, build: Build = init_chat_model) -> None:
    for model, takes in refresh(argv, target, build).items():
        print(f"{model}: {'takes' if takes else 'takes no'} reasoning effort")


if __name__ == "__main__":
    main(sys.argv[1:])
