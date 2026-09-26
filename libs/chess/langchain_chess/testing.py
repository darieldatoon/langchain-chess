"""Test helpers shared by every package's tests. Not used at runtime."""

import asyncio
import sys
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

from langchain_core.language_models.base import LangSmithParams
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from pydantic import PrivateAttr

type Step = str | BaseException | Callable[[list[BaseMessage]], str]


def usage(input_tokens: int = 100, output_tokens: int = 10, **details: Any) -> dict[str, Any]:
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": input_tokens + output_tokens,
        **details,
    }


class ScriptedModel(BaseChatModel):
    """Replies from a script of strings, callables (messages → text) or exceptions (raised).

    Records every request's messages. Reports as `provider`/`model` to the callbacks, so the
    recorder prices its calls like a real model's.
    """

    script: list[Any]
    model: str = "claude-opus-5"
    provider: str = "anthropic"
    delay: float = 0.0
    usage_metadata: dict[str, Any] | None = None
    _index: int = PrivateAttr(default=0)
    _requests: list[list[BaseMessage]] = PrivateAttr(default_factory=list)

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def _get_ls_params(self, stop: list[str] | None = None, **kwargs: Any) -> LangSmithParams:
        return LangSmithParams(
            ls_provider=self.provider, ls_model_name=self.model, ls_model_type="chat"
        )

    @property
    def requests(self) -> list[list[BaseMessage]]:
        return self._requests

    @property
    def calls(self) -> int:
        return self._index

    def _next(self, messages: Sequence[BaseMessage]) -> ChatResult:
        self._requests.append(list(messages))
        if self._index >= len(self.script):
            msg = f"script exhausted after {len(self.script)} replies"
            raise AssertionError(msg)
        step = self.script[self._index]
        self._index += 1
        if isinstance(step, BaseException):
            raise step
        text = step(list(messages)) if callable(step) else step
        meta = self.usage_metadata if self.usage_metadata is not None else usage()
        message = AIMessage(text, usage_metadata=meta or None)
        return ChatResult(generations=[ChatGeneration(message=message)])

    def _generate(
        self, messages: Any, stop: Any = None, run_manager: Any = None, **kwargs: Any
    ) -> ChatResult:
        return self._next(messages)

    async def _agenerate(
        self, messages: Any, stop: Any = None, run_manager: Any = None, **kwargs: Any
    ) -> ChatResult:
        if self.delay:
            await asyncio.sleep(self.delay)
        return self._next(messages)


def human(content: str, id: str | None = None) -> dict[str, Any]:
    """Agent input carrying one human chat message."""
    message: dict[str, Any] = {"type": "human", "content": content}
    if id is not None:
        message["id"] = id
    return {"messages": [message]}


def position(
    moves: Sequence[str] = (), start_fen: str | None = None, restrict: Sequence[str] | None = None
) -> dict[str, Any]:
    """Agent input carrying a position command."""
    command: dict[str, Any] = {"moves": list(moves)}
    if start_fen is not None:
        command["start_fen"] = start_fen
    if restrict is not None:
        command["restrict"] = list(restrict)
    return {"position": command}


FAKE_ENGINE_NAME = "FakeFish 1"

_FAKE_UCI = '''
import sys

import chess

board, multipv = chess.Board(), 1


def say(*lines):
    sys.stdout.write("".join(line + "\\n" for line in lines))
    sys.stdout.flush()


def score(move):
    """Mate in one if the move mates, else the material it leaves, for the side to move."""
    board.push(move)
    mated = board.is_checkmate()
    material = sum(
        {1: 1, 2: 3, 3: 3, 4: 5, 5: 9, 6: 0}[p.piece_type] * (1 if p.color != board.turn else -1)
        for p in board.piece_map().values()
    )
    board.pop()
    return (1_000_000, "mate 1") if mated else (material, f"cp {material * 100}")


for line in sys.stdin:
    words = line.split()
    if not words:
        continue
    if words[0] == "uci":
        say(
            "id name FakeFish 1",
            "option name Threads type spin default 1 min 1 max 512",
            "option name Hash type spin default 16 min 1 max 1024",
            "option name MultiPV type spin default 1 min 1 max 500",
            "uciok",
        )
    elif words[0] == "isready":
        say("readyok")
    elif words[:3] == ["setoption", "name", "MultiPV"]:
        multipv = int(words[4])
    elif words[0] == "position":
        rest = line.split(" moves ")
        fen = rest[0].split(" fen ", 1)[1] if " fen " in rest[0] else chess.STARTING_FEN
        board = chess.Board(fen.strip())
        for uci in rest[1].split() if len(rest) > 1 else []:
            board.push_uci(uci)
    elif words[0] == "go":
        ranked = sorted(board.legal_moves, key=lambda m: (-score(m)[0], m.uci()))
        for i, move in enumerate(ranked[:multipv], 1):
            say(f"info depth 1 multipv {i} score {score(move)[1]} pv {move.uci()}")
        say(f"bestmove {ranked[0].uci()}")
    elif words[0] == "quit":
        break
'''


def fake_engine(directory: Path) -> str:
    """Writes a tiny UCI engine to `directory` and returns its path.

    It ranks moves by mate in one, then material, then UCI order, and names itself
    `FAKE_ENGINE_NAME`. Deterministic, instant, and needs only python-chess.
    """
    path = directory / "fakefish"
    path.write_text(f"#!{sys.executable}\n{_FAKE_UCI}")
    path.chmod(0o755)
    return str(path)
