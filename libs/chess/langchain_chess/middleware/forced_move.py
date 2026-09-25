"""ForcedMoveMiddleware: play the only legal move without asking anyone."""

from collections.abc import Mapping
from typing import Any

from langchain.agents.middleware.types import AgentMiddleware, hook_config

from langchain_chess.state import ChessState


class ForcedMoveMiddleware(AgentMiddleware[ChessState, Any, Any]):
    """Proposes the move when the turn opened with exactly one.

    It reads `turn.initial_allowed`, never `allowed_moves` or `candidates`, so a one-move
    shortlist or a middleware's narrowing is never mistaken for a forced position.
    """

    state_schema = ChessState

    def _forced(self, state: Mapping[str, Any]) -> dict[str, Any] | None:
        initial = state["turns"][-1]["initial_allowed"]
        if state.get("proposal") is None and len(initial) == 1:
            return {"proposal": {"uci": initial[0], "source": "forced"}, "jump_to": "end"}
        return None

    @hook_config(can_jump_to=["end"])
    def before_model(self, state: ChessState, runtime: Any) -> dict[str, Any] | None:
        return self._forced(state)

    @hook_config(can_jump_to=["end"])
    async def abefore_model(self, state: ChessState, runtime: Any) -> dict[str, Any] | None:
        return self._forced(state)
