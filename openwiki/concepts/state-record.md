---
type: data contract
title: The public state record and threads
description: The six ChessState keys clients may read (start_fen, moves, plies, turns, outcome, error), the Ply, TurnRecord and Call shapes, the two input keys (messages and position with restrict), and the one-run-one-turn, one-thread-one-game rules, including which commands are rejected.
tags: [state, record, threads, input, ply, turn-record, call, contract]
verified:
  - by: openwiki/0.6.0
    at: 2026-09-26T04:03:54.007Z
sources:
  - id: openwiki-source-2823ab4258a02b653101a66b
    resource: repo://libs/chess/langchain_chess/contract.py
  - id: openwiki-source-fc393bc7c06df7c3f85ece92
    resource: repo://libs/chess/langchain_chess/middleware/core.py
  - id: openwiki-source-16c6b0ddfc4304538e912111
    resource: repo://libs/chess/langchain_chess/rules.py
  - id: openwiki-source-89cf26730d6633d36dd4f627
    resource: repo://libs/chess/langchain_chess/state.py
  - id: openwiki-source-4611e49b3e9b4d2d0edd598c
    resource: repo://libs/chess/tests/test_lifecycle.py
  - id: openwiki-source-1dd02340acf0ca7c8c33f18b
    resource: repo://libs/cli/langchain_chess_cli/uci/engine.py
  - id: openwiki-source-15a1d3b1618239efaf01080e
    resource: repo://packages/chess-ui/src/selectors.ts
  - id: openwiki-source-fd0e9360c0eb5b2cec5ea440
    resource: repo://packages/chess-ui/src/types.ts
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "openwiki/0.6.0", at: "2026-09-26T04:03:54.007Z" }
---

# The public state record and threads

A chess agent's LangGraph thread holds three kinds of channel:

- **The record.** This is what clients read.
- **The model's working context** (`messages`).
- **Private turn bookkeeping.** Only the middleware uses it.

This page covers the record, the input a caller may send, and how runs and threads map onto turns and games. For how `ChessCore` opens, retries and finalizes a turn step by step, see [the turn lifecycle](/openwiki/architecture/turn-lifecycle.md). For how `Call` is priced, see [models, gateway and cost](/openwiki/concepts/models-gateway-and-cost.md).

All of these types live in `libs/chess/langchain_chess/state.py`. Every value is plain JSON-like data: strings, numbers, lists, TypedDicts and LangChain messages. That keeps everything serializable through LangGraph's codecs. The state has no custom reducers. Who may write which key is enforced by the write guard in `contract.py`, not by the channels.

## What clients may read

`RECORD_KEYS` names the record: `start_fen`, `moves`, `plies`, `turns`, `outcome` and `error`. `ChessCore` owns every one of them. Each is annotated `OmitFromInput`, so it appears in the output schema but is never accepted as input. If a caller sends `moves` or `outcome` alongside a command, the agent ignores them (`test_schemas`).

| Key | Meaning |
|---|---|
| `start_fen` | The game's root. It is normalized through `chess.Board(...).fen()` when a position command sets it. On the first run it defaults to the standard start. |
| `moves` | UCI moves from `start_fen`. They include external moves (from input) and the agent's own moves. |
| `plies` | One `Ply` per entry in `moves`, at the same index. |
| `turns` | Every turn the agent opened, including turns that produced no move (abandoned or terminal). |
| `outcome` | `null`, or a `Checkmate`, `Draw` (with a `DrawReason`) or `Resignation` (`reason: "illegal_moves"`). Once set, it is authoritative. |
| `error` | The reason the last command was rejected. Any accepted command, retry or no-op resets it to `null`. |

On the first run, even one that is rejected or does nothing, `ChessCore._first_run` writes an empty record: the standard `start_fen`, `[]` for the three lists, and `null` for `outcome` and `error`. LangGraph leaves out keys that were never written, so without this step a new game would have no `outcome` at all (`test_first_run_writes_the_empty_record`).

### Why `messages` is not part of the record

`messages` is the model's working context, not a history of the game:

- **Commands don't always arrive as chat.** A position command becomes a synthesized "delta" `HumanMessage` (for example "New game. You are White." or "2. Nf3").
- **Messages get removed or added.** When a command is rejected, its chat message is deleted with `RemoveMessage`. When the model makes an illegal attempt, a feedback `HumanMessage` is added.
- **Some turns have no model reply.** A move from System 1 or a forced move gets a synthesized `AIMessage("MOVE: <san>")`.
- **Summarization rewrites history.** With `memory="summarize"`, `ChessSummarization` replaces older messages. `Ply.message_id` is documented as "the committed AI message (it may since have been summarized away)".

So the durable facts about a move live on `Ply` and `TurnRecord`. Message ids stored there (`message_id`, `opened_message_id`, `rejected_message_ids`, `feedback_message_ids`) are cross-references only and may dangle. The UI's `ChessValues` still lists `messages` as optional, but only so it can stream the live reply. `liveAnalysis` in `packages/chess-ui/src/selectors.ts` finds the newest AI text after the pending turn's `opened_message_id` and skips replies already committed to a ply.

### Why the private channels are not part of it

Some channels hold the working state of a single turn:

- `allowed_moves`, `candidates`, `candidates_by`, `proposal`, `fallback_move`, `attempts`
- `consumed_message_ids`, `terminal_intent`, `invocation`

All are `PrivateStateAttr`. They are left out of both the input and output JSON schemas, and core resets or rewrites them at every turn boundary (`_DECISION_RESET`). The catch is that the thread-state API (`get_state`, or the Agent Server's thread state endpoint) returns **every** channel, including these. That is why `RECORD_KEYS` exists and why the TypeScript `ChessValues` comment says "never read them". Tests read `invocation` (`execute`, `reject` or `noop` for this run only) through `get_state` as a diagnostic. It is not a client contract. `position` is similar: it is `OmitFromOutput`, and core clears it to `None` on every run.

## Record shapes

```mermaid
erDiagram
    ChessState ||--o{ Ply : plies
    ChessState ||--o{ TurnRecord : turns
    TurnRecord ||--o{ Call : calls
    TurnRecord |o--o| Ply : "ply and turn_id"
```
*How the record links together: a committed turn points at its ply by index, and a policy ply points back at its turn by id.*

**`Ply`**: one half-move.

- `ply` is the half-move's index. `side` is the side that moved.
- `uci` and `san` give the move in both notations.
- `source` is `"external"` for moves that came from input. Otherwise it is the proposal's source: `llm`, `systemone`, `forced`, or an extension's name.
- `analysis` holds the reply text for LLM moves.
- `message_id`, `turn_id` and `model` are all `null` on external plies.
- `latency_ms` is the owning turn's summed model-call time.
- `meta` holds per-middleware telemetry keyed by middleware name. For example, `meta["SystemOneMiddleware"]` holds System 1's shortlist and gate.

For an LLM move, `model` is the model of the turn's last `llm` call. For other sources it comes from `proposal.meta["model"]`. `ChessCore._finalize` builds the ply and gathers `meta` from each extension's `ply_meta()`.

**`TurnRecord`**: one attempt by the agent to move.

- `id` identifies the turn.
- `request` is a fingerprint of the command that opened it: the chat message id, or `position:<sha256>` of the start FEN, the moves and the sorted `restrict`.
- `initial_allowed` is the legal moves intersected with `restrict`, taken when the turn opened. A retry restores it.
- `status` is `pending`, `committed`, `abandoned` or `terminal`. `ply` is set only when the status is `committed`.
- `calls` lists every model call made during the turn.
- `rejected_message_ids`, `feedback_message_ids` and `illegal_attempts` record illegal replies. `opened_message_id` is the message that opened the turn.
- `latency_ms` is the summed model-call time.

Extensions' own calls (from `turn_calls()`) are added to `calls` when a turn is finalized or abandoned.

```mermaid
stateDiagram-v2
    [*] --> pending: new command accepted
    [*] --> terminal: command reaches a finished position
    pending --> committed: move finalized
    pending --> terminal: resignation after retries
    pending --> abandoned: newer position replaces it
    pending --> pending: retry after a failed run
```
*The lifecycle of `TurnRecord.status`. Only the last turn can be `pending`.*

**`Call`**: one provider response.

- `kind` is `llm`, `systemone` or `summary`. `model` is the canonical `provider:model`.
- Token counts: `input_tokens`, `output_tokens`, `reasoning_tokens`, `cache_read_tokens`, `cache_write_tokens`, and `cache_write_1h_tokens` (the 1-hour subset of cache writes).
- `called_at` is an ISO 8601 timestamp.
- Price fields: `cost_usd`, `cost_complete` and `priced_with` (the genai-prices version).

Unreported usage shows up as `null`. SemIf, for example, reports no token counts, so its calls have `cost_usd: null` (`test_a_call_without_usage_has_no_cost`). A move costs its whole turn: `turn_cost` in Python, and its mirror `turnCost` in `selectors.ts`. Grading and review read the same shapes (see [grading and review](/openwiki/workflows/grading-and-review.md)).

### The TypeScript mirror

`packages/chess-ui/src/types.ts` is a hand-written copy of these Python types: `Side`, `DrawReason`, `Outcome`, `Call`, `TurnStatus`, `TurnRecord`, `Ply`, and `ChessValues` for the readable keys. Its header says: "Keep them in step by hand." Nothing generates or checks it. **If you change a field in `state.py`, change `types.ts` in the same commit.** Otherwise `apps/web` and `apps/review` will quietly misread threads. See [web frontends](/openwiki/architecture/web-frontends.md) for the code that uses these types. Selectors such as `turnOf` (a ply's turn found through `turn_id`), `lastPolicyPly` (the last ply with a non-`external` source) and `isPending` (the last turn is `pending`) rely on the relationships described above.

## Input: `messages` or `position`

The agent's input schema has exactly two properties, `messages` and `position` (`ChessInput`). A run carries **one** command:

- **A chat message**: the newest `HumanMessage`, if its id isn't in `consumed_message_ids`. Its text must be `go` or a single legal move in SAN or UCI. A move is recorded as an `external` ply before the agent replies. Anything else is rejected as "neither `go` nor a legal move".
- **A `position`**: `{start_fen?, moves?, restrict?}`. `start_fen` defaults to the standard start, and `moves` are UCI moves from it. `restrict` is a hard limit on which moves the agent may consider, like UCI `searchmoves`. It must be non-empty and every entry must be legal in the resulting position. The allowed set is the legal moves intersected with `restrict`, kept in legal-move order. If only one move is allowed, forced-move handling plays it (`source: "forced"`). The UCI adapter drops illegal `searchmoves` itself and never widens the restriction.

Sending both is rejected: "send a position or a message, not both".

## One run, one turn; one thread, one game

The agent always plays the side to move, and a run plays at most one turn. `ChessCore._lifecycle` (in `before_agent`, the first hook of every run) sorts each run into one of the paths below.

```mermaid
flowchart TD
    A[run starts] --> B{"position and new message?"}
    B -- yes --> R1["reject: not both"]
    B -- no --> C{"outcome set?"}
    C -- "yes, with a command" --> R2["reject: the game is over"]
    C -- "yes, no command" --> N[noop]
    C -- no --> D{"any command?"}
    D -- no --> P{"last turn pending?"}
    P -- yes --> RT[retry pending turn]
    P -- no --> N
    D -- yes --> E{"same request as last turn?"}
    E -- yes --> P
    E -- no --> F{"pending and chat message?"}
    F -- yes --> R3["reject: finish or retry first"]
    F -- no --> G{"command valid and extends game?"}
    G -- no --> R4["reject with CommandError text"]
    G -- yes --> H["abandon any pending turn, open new turn"]
```
*How `before_agent` handles a run. Rejections set `error` and end the run without touching the game.*

The rules that follow from this:

- **Idempotent resubmission.** If the same command arrives again (same message id or same position fingerprint) after its turn committed, nothing happens. No model call is made and no turn is added (`test_same_chat_message_twice_is_a_noop`). If the turn is still pending, for example after a provider error, the resend retries it in place (`test_resent_position_retries_a_failed_turn`).
- **An empty run retries or does nothing.** `{}` or `{"messages": []}` retries a pending turn and is otherwise a no-op. Passing `None` as input resumes the finished checkpoint and runs nothing. A retry reuses a proposal or resignation that already passed validation instead of asking the model again.
- **A pending turn blocks new chat.** A new chat message while a turn is pending is rejected, and the message is removed. A new *position* instead marks the pending turn `abandoned` and opens a fresh one.
- **The game must extend.** A position command is validated against the thread's game. With the thread's game called *G*, the rejections are:
  - `"a different starting position; use a new thread"`: *G* has moves and the root differs from its root.
  - `"invalid FEN …"` or `"invalid position: …"`: the root is invalid.
  - `"`<uci>` is not a legal move here"` or `"move N (uci) comes after the game ended (…)"`: a requested move is illegal, or follows an ending. The replay checks for an ending before every ply.
  - `"restrict must not be empty"` or `"restrict contains moves that are not legal here"`.
  - `"the position does not extend this game; use a new thread"`: the requested moves don't start with *G*'s `moves`. This also applies when the only change is a new `restrict` on a shorter move list (`test_same_root_with_a_new_restriction_is_rejected_as_diverged`).
- **Takebacks and new games need a new thread.** The UCI adapter checks this itself (`_thread_extends`) and starts a fresh thread when the GUI's position doesn't extend the current one.
- **Finished games are closed.** Once `outcome` is set, every command is rejected with "the game is over" and empty runs are no-ops. This check comes before any replay, because a resignation can't be worked out again from the board.
- **Terminal positions don't call the model.** If a command's position is already checkmate or an automatic draw, or with `draw_claims="auto"` a threefold repetition or fifty-move draw that has actually happened, a `terminal` turn is recorded along with the outcome and a result message. The model is never called. Draws the next move could claim are never adjudicated early (`rules.ending`).

A rejection writes only `error`, `invocation` and the cleared `position`, plus the empty record on a first run. `moves`, `plies` and `turns` stay as they were. Without a checkpointer the agent is stateless: every run starts a new game from its own input (`test_stateless_agent`).

## Changing the record safely

- New public fields go on `ChessState` with `OmitFromInput`, and in `RECORD_KEYS` if clients should read them. Mirror them in `types.ts`.
- Extension-specific data belongs in `Ply.meta[<middleware name>]` through `ply_meta()`, or in `TurnRecord.calls` through `turn_calls()`. Don't add new top-level record keys for it. An extension's own state keys must be `PrivateStateAttr`. The write guard rejects extension writes to core-owned keys ("core-owned") and only allows writes to `allowed_moves`, `proposal`, `fallback_move` and `candidates`.
- `libs/chess/tests/test_lifecycle.py` is the behavioural spec for everything on this page, including schemas, no-ops, retries, rejections and terminal positions.
