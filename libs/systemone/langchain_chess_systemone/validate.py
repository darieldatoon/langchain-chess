"""Per-Choice response validation. Pure.

`ChoiceAnswer` itself accepts negative, NaN, all-zero and unnormalized probabilities, and an
unnormalized distribution would scale the margin gate (6.0/2.5/1.5 gives a margin of 3.5).
Each Choice is validated against its own option set: a single ranking, each heat, the final.
"""

import math
from collections.abc import Mapping, Sequence

from langchain_chess_systemone.types import Candidate, ChoiceResult

SUM_TOLERANCE = 1e-3


class MalformedChoice(ValueError):  # noqa: N818
    pass


def validate_choice(
    options: Sequence[str], probabilities: Mapping[str, float], confidence: float
) -> ChoiceResult:
    """Rank `options` by the answer's probabilities; a missing label counts as 0."""
    unknown = set(probabilities) - set(options)
    if unknown:
        msg = f"labels that were not options: {sorted(unknown)}"
        raise MalformedChoice(msg)
    values = [float(probabilities.get(uci, 0.0)) for uci in options]
    if not all(math.isfinite(p) and 0.0 <= p <= 1.0 for p in values):
        msg = "probabilities must be finite and within [0, 1]"
        raise MalformedChoice(msg)
    total = sum(values)
    if abs(total - 1.0) > SUM_TOLERANCE:
        msg = f"probabilities sum to {total:.6f}, not 1"
        raise MalformedChoice(msg)
    if not (math.isfinite(confidence) and 0.0 <= confidence <= 1.0):
        msg = f"confidence {confidence} is not within [0, 1]"
        raise MalformedChoice(msg)
    order = sorted(range(len(options)), key=lambda i: (-values[i], i))
    ranked = tuple(Candidate(uci=options[i], probability=values[i] / total) for i in order)
    return ChoiceResult(ranked=ranked, confidence=confidence)
