"""`setup`: the opponent settings a game started with, in its own thread state.

Any client can then continue a game from its thread alone. The settings are the run's resolved
`ChessContext`, written on the game's first turn and never again: a later run plays with its own
settings, and `setup` still names the first turn's. A thread from before `setup` never gains one.
"""

from dataclasses import asdict
from typing import Annotated, Any, NotRequired

from langchain.agents.middleware.types import AgentMiddleware, OmitFromInput

from langchain_chess import ChessState
from langchain_chess.state import JSONValue
from langchain_chess_server.context import ChessContext


class SetupState(ChessState):
    # Not private: clients read it to continue the game.
    setup: NotRequired[Annotated[dict[str, JSONValue], OmitFromInput]]


class GameSetupMiddleware(AgentMiddleware[SetupState, Any, Any]):
    state_schema = SetupState

    def __init__(self, context: ChessContext) -> None:
        self.setup: dict[str, JSONValue] = asdict(context)

    def _first_turn(self, state: dict[str, Any]) -> dict[str, Any] | None:
        """Only the run that opened the game's first turn: a thread from before `setup` has a
        first turn too, opened with settings nobody recorded."""
        turns = state.get("turns") or []
        opened = (state.get("invocation") or {}).get("opened_turn")
        if "setup" in state or len(turns) != 1 or turns[0]["id"] != opened:
            return None
        return {"setup": dict(self.setup)}

    # Before the model, so a turn that fails still has it; after, because a turn that ends the
    # game jumps from ChessCore.before_agent straight past this middleware's before_agent.
    def before_agent(self, state: Any, runtime: Any) -> dict[str, Any] | None:
        return self._first_turn(state)

    async def abefore_agent(self, state: Any, runtime: Any) -> dict[str, Any] | None:
        return self._first_turn(state)

    def after_agent(self, state: Any, runtime: Any) -> dict[str, Any] | None:
        return self._first_turn(state)

    async def aafter_agent(self, state: Any, runtime: Any) -> dict[str, Any] | None:
        return self._first_turn(state)
