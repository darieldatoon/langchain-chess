"""The experiment target: rank an example's legal moves as `SystemOneMiddleware` would."""

import hashlib
import json
from collections.abc import Awaitable, Callable, Mapping
from typing import Any

from langchain_chess_systemone import MoveDistribution, Ranker, RankingFailed, RankRequest

type Outputs = dict[str, Any]
type Target = Callable[[dict[str, Any]], Awaitable[Outputs]]


def request_of(inputs: Mapping[str, Any]) -> RankRequest:
    """The tournament seed comes from the position, so every run of an example shuffles alike."""
    key = json.dumps([inputs["start_fen"], inputs["moves"]]).encode()
    return RankRequest(
        start_fen=inputs["start_fen"],
        moves=tuple(inputs["moves"]),
        options=tuple(inputs["legal"]),
        seed=int.from_bytes(hashlib.sha256(key).digest()[:8], "big"),
    )


def _tokens(values: list[int | None]) -> int | None:
    return None if not values or None in values else sum(v for v in values if v is not None)


def outputs_of(distribution: MoveDistribution) -> Outputs:
    tournament = distribution.tournament
    return {
        "ranked": [{"uci": c.uci, "probability": c.probability} for c in distribution.candidates],
        "confidence": distribution.confidence,
        "margin": distribution.margin,
        "tournament": tournament is not None,
        "finalists": list(tournament["finalists"]) if tournament else None,
        "heats": dict(tournament) if tournament else None,
        "requests": len(distribution.calls),
        "input_tokens": _tokens([c["input_tokens"] for c in distribution.calls]),
        "output_tokens": _tokens([c["output_tokens"] for c in distribution.calls]),
        "latency_ms": distribution.latency_ms,
        "error": None,
    }


def failure_outputs(error: RankingFailed) -> Outputs:
    """A failed ranking scores as a miss, as the middleware would fall back to the LLM."""
    return {
        "ranked": [],
        "confidence": None,
        "margin": None,
        "tournament": False,
        "finalists": None,
        "heats": None,
        "requests": len(error.calls),
        "input_tokens": _tokens([c["input_tokens"] for c in error.calls]),
        "output_tokens": _tokens([c["output_tokens"] for c in error.calls]),
        "latency_ms": error.elapsed_ms,
        "error": str(error),
    }


def make_target(ranker: Ranker) -> Target:
    async def systemone(inputs: dict[str, Any]) -> Outputs:
        try:
            return outputs_of(await ranker.arank(request_of(inputs)))
        except RankingFailed as e:
            return failure_outputs(e)

    return systemone
