---
type: architecture
title: "The agent loop: ChessCore and the turn lifecycle"
description: How create_chess_agent assembles its middleware stack and how ChessCore plays at most one turn per run, covering command classification, pending, abandoned, committed and terminal turns, reply parsing, illegal-move retries and resignation, the forced-move shortcut, atomic finalization, draw claims and ContextBudgetError.
tags: [chess-core, turn-lifecycle, agent-loop, middleware, retries, finalization]
verified:
  - by: openwiki/0.6.0
    at: 2026-09-26T04:03:54.007Z
sources:
  - id: openwiki-source-3ae14faf8cc85a90b40ed182
    resource: repo://libs/chess/langchain_chess/agent.py
  - id: openwiki-source-2823ab4258a02b653101a66b
    resource: repo://libs/chess/langchain_chess/contract.py
  - id: openwiki-source-fc393bc7c06df7c3f85ece92
    resource: repo://libs/chess/langchain_chess/middleware/core.py
  - id: openwiki-source-39bd12bdddf97b4c91560f31
    resource: repo://libs/chess/langchain_chess/middleware/forced_move.py
  - id: openwiki-source-c79cd4ef1f60f33f3f30297b
    resource: repo://libs/chess/langchain_chess/parse.py
  - id: openwiki-source-e92c3d9adb77a4ffddf28116
    resource: repo://libs/chess/langchain_chess/prompt.py
  - id: openwiki-source-16c6b0ddfc4304538e912111
    resource: repo://libs/chess/langchain_chess/rules.py
  - id: openwiki-source-2c6a2617bc273a5be95fdd7d
    resource: repo://libs/chess/tests/test_contract.py
  - id: openwiki-source-4611e49b3e9b4d2d0edd598c
    resource: repo://libs/chess/tests/test_lifecycle.py
  - id: openwiki-source-6e2fb5fdba06bd3460a12c1f
    resource: repo://libs/chess/tests/test_rules.py
generated: { by: "openwiki/0.6.0", at: "2026-09-26T04:03:54.007Z" }
---

# The agent loop: ChessCore and the turn lifecycle

`create_chess_agent` (`libs/chess/langchain_chess/agent.py`) is a thin wrapper around LangChain's `create_agent(tools=[])`. It passes no tools. All chess behaviour lives in middleware, and one middleware owns the game: `ChessCore` (`libs/chess/langchain_chess/middleware/core.py`). This page covers how one run becomes at most one turn, and the invariants you must keep when you change that code.

Related pages: [middleware contract](/openwiki/concepts/middleware-contract.md) (what extensions may write), [state record](/openwiki/concepts/state-record.md) (the keys clients read), [prompt and memory](/openwiki/concepts/prompt-and-memory.md) (what the model sees), [System 1](/openwiki/architecture/system-one.md) (the main proposer), and [runtime behavior](/openwiki/operations/runtime-behavior.md) (what production runs look like).

## The stack `create_chess_agent` builds

The stack always has the same shape:

1. **`ChessCore`** comes first. Its `before_agent` runs first, its `wrap_model_call` is the outermost wrapper, and its `after_model` and `after_agent` run last. It receives the guarded extensions so that it can collect their `turn_calls` and `ply_meta` when a turn finishes.
2. **`ForcedMoveMiddleware`** comes next, unless you pass `forced_move=False`.
3. **User middleware** comes after that. Each one is wrapped by `guard()` from `contract.py`. The guard gives each hook a detached copy of the state and checks every write. Two extensions may not declare the same private state key; if they do, construction fails with a `ChessContractError`.
4. **`ChessSummarization`** comes last, and only when `memory="summarize"`. Being last means it runs only right before a real LLM call. This mode requires a model.

If `model` is `None`, the stack gets a `NoModel` stand-in. Calling it raises `ChessContractError`, so a System-1-only agent fails loudly when no proposer fires. It never plays a random move. After compiling, the factory checks that the graph's input schema contains only `messages` and `position`. An extension that leaks a public state key fails at build time. The compiled graph is returned with a `CallRecorder` callback attached. That callback captures every provider response for the turn's `calls`.

Without a checkpointer the agent is stateless, so every run must carry a `position` (see `test_stateless_agent`).

## Invariants a change must keep

- **One run plays at most one turn. One thread is one game.** `before_agent` decides the run's `invocation.action`, which is one of `execute`, `reject` or `noop`. Only an `execute` run can call the model or finalize anything. `reject` and `noop` jump straight to `end`.
- **A retry replays a validated decision. It does not ask again.** When a pending turn is retried and a `proposal` or `terminal_intent` is already in state, `_retry` jumps directly to `end` so that `after_agent` finalizes it. Asking the model again would cost money and could change the move. `test_a_committed_proposal_survives_a_failing_after_agent` and `test_a_resignation_survives_a_failing_after_agent` in `tests/test_contract.py` pin this: the model is called exactly as often as it was in the failed run.
- **`before_model` is re-entered.** An illegal reply makes `after_model` jump back to `model`. In `create_agent` that re-runs every `before_model` hook. A fresh retry of a pending turn with no decision yet resets `allowed_moves` to the turn's `initial_allowed` and clears `proposal`, `candidates`, `candidates_by`, `fallback_move` and `attempts` (`_DECISION_RESET`). For these reasons extension `before_model` hooks must be idempotent. They must freeze decisions per `turn_id` and replay them as `current allowed ∩ frozen` (the rule is in the `ChessMiddleware` docstring in `contract.py`).
- **Finalization is atomic and happens in one place.** Only `after_agent` writes `moves`, `plies`, the turn's final status and `outcome` for an agent move. A failure before that point leaves the turn `pending` with the model's reply still in state, and the next run can recover it.
- **Every check replays from the root.** `rules.replay` rebuilds the board from `start_fen` with the full move stack. A board built from a FEN alone has no history and would never see a repetition.

## Command classification (`before_agent`)

A run's input is either a `position` (`start_fen`, UCI `moves`, optional `restrict`) or a new, unconsumed `HumanMessage`. The request key is a SHA-256 `fingerprint` of the position (the order of `restrict` is ignored, but whether it is present is not), or the message id.

```mermaid
flowchart TD
    A["run starts"] --> B{"position and new message both present"}
    B -- yes --> R1["reject"]
    B -- no --> C{"outcome already set"}
    C -- "yes, with a command" --> R2["reject: game is over"]
    C -- "yes, empty run" --> N1["noop"]
    C -- no --> D{"any command"}
    D -- no --> P1{"last turn pending"}
    P1 -- yes --> RT["retry"]
    P1 -- no --> N2["noop"]
    D -- yes --> E{"same request as last turn"}
    E -- yes --> P2{"last turn pending"}
    P2 -- yes --> RT
    P2 -- no --> N3["noop"]
    E -- no --> F{"pending turn and chat message"}
    F -- yes --> R3["reject: finish or retry first"]
    F -- no --> G{"sync validates"}
    G -- "no, CommandError" --> R4["reject"]
    G -- yes --> H{"position already ended"}
    H -- yes --> T["open terminal turn, noop"]
    H -- no --> X["open pending turn, execute"]
```
*How `ChessCore._lifecycle` classifies a run. A new position that validates while a turn is pending abandons that turn before opening the new one.*

Details that matter when you change this:

- **Chat sync** (`_sync_chat`) accepts exactly `go` or one legal move in SAN or UCI (`rules.parse_chat`). Anything else raises `CommandError`, including null-move spellings such as `0000` (`legal_member` checks that the move is in the legal set, not just that it parses). The human's move is recorded as an `external` ply.
- **Position sync** (`_sync_position`) requires the requested moves to *extend* the thread's game, with the same root and the thread's moves as a prefix. A `restrict` list must be non-empty and legal. New moves become `external` plies. A synthetic delta `HumanMessage` is added, such as "New game. You are White." or the new movetext. Takebacks and new games need a new thread.
- A rejected chat message is removed from `messages` (`RemoveMessage`), and the reason goes into `error`. The game record is never touched.
- Resending the same message id, or the same position after a commit, is a `noop`. Resending the same position while its turn is still pending is a retry. This is how clients recover after a provider error (`test_resent_position_retries_a_failed_turn`).
- A resignation cannot be rederived from the board. The check for `outcome` therefore runs before any sync.

## The turn lifecycle

Each `TurnRecord` in `turns` has a `status`: `pending`, `committed`, `abandoned` or `terminal`.

```mermaid
stateDiagram-v2
    [*] --> Pending: execute opens a turn
    [*] --> Terminal: command reaches an ended position
    Pending --> Pending: run fails, a later run retries
    Pending --> Committed: after_agent commits the proposal
    Pending --> Terminal: retries exhausted, resignation
    Pending --> Abandoned: a new valid position arrives
    Committed --> [*]
    Terminal --> [*]
    Abandoned --> [*]
```
*The states a TurnRecord moves through. A committed move that ends the game stays `committed` and sets `outcome`. Only an ended input position or a resignation produces a `terminal` turn.*

When a turn opens, `initial_allowed` is set to the legal moves, filtered by `restrict`. This list is the turn's hard constraint, and the forced-move check and every retry reset use it. When a turn is abandoned, the extensions' `turn_calls` are folded into its `calls`, so the cost of the abandoned work is still recorded. This is how the UCI adapter's fallback moves show up: the GUI's next position includes the fallback move, which abandons the pending turn.

## The model call (`wrap_model_call`)

`ChessCore` is the outermost wrapper. It rewrites the request's messages as `model_view(...)` followed by a trailing position block from `render_position`. The position block is never stored. It contains the movetext, FEN, ASCII board, side to move, any suggested `candidates`, and either the restricted move list or the full legal-move list (controlled by `show_legal_moves`). `model_view` depends on `memory`. With `none` the model sees only the current turn, starting from its opening message. With `full` or `summarize` it sees the whole history, minus earlier turns' rejected attempts and feedback. In both modes the current turn shows only its latest rejected reply, reasoning blocks are removed from other AI messages, and every message is deep-copied so that wrappers cannot change state. See [prompt and memory](/openwiki/concepts/prompt-and-memory.md).

Everything the provider returns inside the wrapper is captured through `recorder.sink("llm")` and appended to the turn's `calls`. The wall-clock time of the wrapper is added to `turn.latency_ms`. `after_model` does not run if the call fails, but the calls have already been captured. An empty AI reply is stored as the `EMPTY_REPLY` placeholder (`[no text in reply]`), because Anthropic rejects a replayed assistant turn that has no text.

**`ContextBudgetError`**: if the provider raises an exception whose text matches one of the overflow hints (`prompt is too long`, `context length`, `maximum context`, `too many tokens`, and so on), the wrapper re-raises it as `ContextBudgetError`. The turn stays `pending`. Other exceptions propagate unchanged and also leave the turn pending.

## Reply parsing, retries and resignation (`after_model`)

`parse.parse_move` reads the move from the reply. The last `MOVE:` line wins. If there is no such line, the last move-like token is used. Each candidate is tried as SAN first, then as UCI, and it must be legal. `_parse` then applies these rules:

- If the move is legal **and** in `allowed_moves`, it becomes the `proposal` (`source: "llm"`, with the reply text as `analysis`).
- If the move is legal but not allowed (because of `restrict` or a middleware narrowing it), or if no move was found, the reply id is added to `rejected_message_ids` and `illegal_attempts` goes up by one. If `attempts < max_retries`, a feedback `HumanMessage` ("Try again, ... Choose from: ...") is added and the run jumps back to `model`. Remember that this re-runs `before_model`.
- Once `max_retries` (default 3) retries are used up, a `terminal_intent` resignation for the side to move is set (`reason: "illegal_moves"`). With the default setting that happens after four illegal replies.

## Forced-move shortcut

When `turn.initial_allowed` has exactly one move and no proposal exists yet, `ForcedMoveMiddleware.before_model` proposes that move (`source: "forced"`) and jumps to `end`. No model is called. It deliberately reads `initial_allowed` rather than `allowed_moves` or `candidates`, so a narrowing or a one-move shortlist never counts as a forced position. A position whose `restrict` has one move therefore counts as forced (`test_the_same_position_again_gives_a_new_turn`).

## Atomic finalization (`after_agent`)

`_finalize` acts only when `invocation.action == "execute"`:

- If a **`terminal_intent`** is set, the turn becomes `terminal`, `outcome` is set, and a result message is added (for example "White resigns after repeated illegal moves. 0-1").
- If a **`proposal`** is set, it is checked again against both the board's legal moves and `allowed_moves`. If either check fails, it raises `ChessContractError`. If neither a proposal nor an intent exists, that is also a `ChessContractError`. The ply is appended with source, analysis, model (for LLM moves, the last `llm` call's model), `turn_id`, the turn's `latency_ms`, and each extension's `ply_meta`. A proposal that did not come from the LLM also gets a synthetic `MOVE: <san>` AI message. The turn becomes `committed`, and all decision keys are reset.
- Last, `ending(board, draw_claims)` checks the new position. If the game has ended, `outcome` and a result message are written in the same update.

## Draw claims

`rules.ending` always applies automatic endings: checkmate, stalemate, insufficient material, fivefold repetition and the 75-move rule. With `draw_claims="auto"`, it also ends the game on a threefold repetition or fifty-move rule that has **actually happened**. It never uses `outcome(claim_draw=True)` or `can_claim_threefold_repetition()`, because those would declare a draw the next move merely could reach, before the agent has moved (`test_threefold_is_not_adjudicated_before_the_agent_moves`). The default is `"never"`, which leaves claimable draws to the caller. The UCI adapter relies on this default. `replay` checks for an ending before every ply, so a position with moves after the game ended is rejected as a `CommandError`.

## Focused tests

- `libs/chess/tests/test_lifecycle.py`: classification (noop, reject, retry), abandonment, illegal retries and the model view on the third attempt, resignation, `restrict`, terminal inputs, draws, empty replies and `ContextBudgetError`.
- `libs/chess/tests/test_rules.py`: endings, draw claims only once they have occurred, replay rejecting moves after an ending, `parse_chat` strictness, fingerprint semantics.
- `libs/chess/tests/test_contract.py`: finalization surviving a failing `after_agent` or `after_model` hook, and `NoModel` failing loudly.

## Runtime evidence

This subsection covers **sampled traces only**. The trace sample is weighted toward anomalies (error and outlier buckets), so read nothing here as a fleet-wide rate. This pull's figures for model calls per turn, illegal-retry frequency and turn latency are kept on [runtime behavior](/openwiki/operations/runtime-behavior.md). This page does not restate them, because they change with every pull.

- **Observed:** no aggregated trace figures were available while this page was written. Take per-turn call counts and latency from [runtime behavior](/openwiki/operations/runtime-behavior.md) rather than from this page.
- **Correlated:** the code sets expectations you can check against traces. A normal LLM turn makes one `llm` call. Each illegal reply adds one more call, up to `max_retries + 1` calls, which is 4 with the default, before the turn resigns. A forced move, or a proposal from middleware, makes zero LLM calls. `turn.latency_ms`, which is also copied onto the ply, measures only the time inside `ChessCore.wrap_model_call`. It excludes `before_model` work such as System 1 ranking, so trace root latency will be higher than the recorded ply latency.
- **Hypothesis:** if sampled turns often show several LLM calls, the retry and feedback path is a cost driver. Check the rejected-reply signature (no `MOVE:` line, empty reply, or a disallowed move) before you change `feedback_text`, `SYSTEM_PROMPT` or `max_retries`.
