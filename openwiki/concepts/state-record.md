---
type: data contract
title: The state record
description: The ChessState keys clients may read (start_fen, moves, plies, turns, outcome, error, draw_offers, plus middleware keys such as the Agent Server's setup and System 1's systemone_live), the Ply, TurnRecord, Call and DrawOffer shapes, why messages and private channels are excluded, the two input keys (messages and position with restrict) including the resign and draw chat commands, and the one-run-one-turn, one-thread-one-game rules.
tags: [state, record, threads, input, ply, turn-record, call, draw-offers, resignation, setup, contract]
verified:
  - by: openwiki/0.6.0
    at: 2026-11-01T01:10:29.908Z
sources:
  - id: openwiki-source-88d085345a1ecd09c61f7ab0
    resource: repo://apps/server/langchain_chess_server/game_setup.py
  - id: openwiki-source-c9b903d37e22daedc4499a4b
    resource: repo://apps/server/langchain_chess_server/graph.py
  - id: openwiki-source-08efc3f1935724156208ec17
    resource: repo://apps/server/tests/test_graph.py
  - id: openwiki-source-3cb426dd15d324cb1ef8679d
    resource: repo://apps/web/src/settings.ts
  - id: openwiki-source-be4a82601d4a0ee9e1634703
    resource: repo://apps/web/src/setup.ts
  - id: openwiki-source-2823ab4258a02b653101a66b
    resource: repo://libs/chess/langchain_chess/contract.py
  - id: openwiki-source-fc393bc7c06df7c3f85ece92
    resource: repo://libs/chess/langchain_chess/middleware/core.py
  - id: openwiki-source-16c6b0ddfc4304538e912111
    resource: repo://libs/chess/langchain_chess/rules.py
  - id: openwiki-source-89cf26730d6633d36dd4f627
    resource: repo://libs/chess/langchain_chess/state.py
  - id: openwiki-source-41c0563f5680b451c8206c47
    resource: repo://libs/chess/README.md
  - id: openwiki-source-15c007567b3e97d780416043
    resource: repo://libs/chess/tests/test_commands.py
  - id: openwiki-source-4611e49b3e9b4d2d0edd598c
    resource: repo://libs/chess/tests/test_lifecycle.py
  - id: openwiki-source-1dd02340acf0ca7c8c33f18b
    resource: repo://libs/cli/langchain_chess_cli/uci/engine.py
  - id: openwiki-source-3c3f476720af9ceef23b678d
    resource: repo://libs/systemone/langchain_chess_systemone/middleware.py
  - id: openwiki-source-21de6a067affac443ab60933
    resource: repo://libs/systemone/langchain_chess_systemone/settings.py
  - id: openwiki-source-b6047122232d689643d18ad5
    resource: repo://packages/chess-ui/src/generated/settings.ts
  - id: openwiki-source-15a1d3b1618239efaf01080e
    resource: repo://packages/chess-ui/src/selectors.ts
  - id: openwiki-source-c81a61ad418f9c19c518d61d
    resource: repo://packages/chess-ui/src/settings.ts
  - id: openwiki-source-8f4a6ef492dd86b6058c2cff
    resource: repo://packages/chess-ui/src/stages.ts
  - id: openwiki-source-fd0e9360c0eb5b2cec5ea440
    resource: repo://packages/chess-ui/src/types.ts
generated: { by: "openwiki/0.6.0", at: "2026-11-01T01:10:29.908Z" }
---

# The state record

A chess agent's LangGraph thread holds three kinds of channel:

- **The record.** This is what clients read.
- **The model's working context** (`messages`).
- **Private turn bookkeeping.** Only the middleware uses it.

This page covers the record, the input a caller may send, and how runs and threads map onto turns and games. For how `ChessCore` opens, retries and finalizes a turn step by step, see [the turn lifecycle](/openwiki/architecture/turn-lifecycle.md). For the extension rules (`ply_meta`, `turn_calls`, `turn_latency_ms`, the write guard), see [the middleware contract](/openwiki/concepts/middleware-contract.md). For how `Call` is priced, see [models, gateway and cost](/openwiki/concepts/models-gateway-and-cost.md).

All of these types live in `libs/chess/langchain_chess/state.py`. Every value is plain JSON-like data: strings, numbers, lists, TypedDicts and LangChain messages. That keeps everything serializable through LangGraph's codecs. The state has no custom reducers. Who may write which key is enforced by the write guard in `contract.py`, not by the channels.

## What clients may read

`RECORD_KEYS` names the record: `start_fen`, `moves`, `plies`, `turns`, `outcome`, `error` and `draw_offers`. `ChessCore` owns every one of them. Each is annotated `OmitFromInput`, so it appears in the output schema but is never accepted as input. If a caller sends `moves` or `outcome` alongside a command, the agent ignores them (`test_schemas`, `test_draw_offers_are_part_of_the_record`).

| Key | Meaning |
|---|---|
| `start_fen` | The game's root. It is normalized through `chess.Board(...).fen()` when a position command sets it. On the first run it defaults to the standard start. |
| `moves` | UCI moves from `start_fen`. They include external moves (from input) and the agent's own moves. |
| `plies` | One `Ply` per entry in `moves`, at the same index. |
| `turns` | Every turn the agent opened, including turns that produced no move (abandoned or terminal). |
| `outcome` | `null`, or a `Checkmate`, a `Draw` (with a `DrawReason`) or a `Resignation`. A resignation's `reason` is `"illegal_moves"` (a forfeit after running out of attempts at a legal move) or `"resigned"` (a `resign <side>` chat command). Once set, it is authoritative. |
| `error` | The reason the last command was rejected. Any accepted command, retry, no-op, draw offer or resignation resets it to `null`. |
| `draw_offers` | One `DrawOffer` per draw offered: `ply` (`len(moves)` when offered, possibly 0), `by` (the side) and `answer` (currently always `"declined"`). It is absent on games recorded before draw offers existed; read it as `[]`. |

The library README's "The record is…" sentence still lists only the first six keys; `RECORD_KEYS` in `state.py` is authoritative and includes `draw_offers`.

On the first run, even one that is rejected or does nothing, `ChessCore._first_run` writes an empty record: the standard `start_fen`, `[]` for `moves`, `plies`, `turns` and `draw_offers`, and `null` for `outcome` and `error` (it also seeds the private `consumed_message_ids` with `[]`). LangGraph leaves out keys that were never written, so without this step a new game would have no `outcome` at all (`test_first_run_writes_the_empty_record`). A consequence for clients: `start_fen` alone does not prove the server accepted a root. The UI's `rootAccepted` selector treats the root as taken only once any turn exists.

### Middleware-owned readable keys

The core record is not closed to additions: the core README tells clients to read the record keys "plus any your own middleware documents (the Agent Server's `setup`, or System 1's `systemone_live`)". A middleware key that is `OmitFromInput` but not `PrivateStateAttr` appears in the output and the thread state for clients to read.

**`systemone_live`** (on `SystemOneState`, from `SystemOneMiddleware`) is System 1's decision as soon as it is made, before the LLM runs, so a UI can show it while the model is still thinking. It is never cleared, so clients read it through `liveSystemOne` (`packages/chess-ui/src/stages.ts`), which returns it only while its `turn_id` names the last turn and that turn is still `pending`.

**`setup`** comes from the Agent Server's graph, which adds `GameSetupMiddleware` (`apps/server/langchain_chess_server/game_setup.py`). Its `SetupState` extends `ChessState` with `setup`, annotated `OmitFromInput` but deliberately **not** private so clients can read it.

- `setup` is `dump(ChessContext)` from `langchain_chess_systemone.settings`: the run's resolved opponent settings as JSON, with **every key of the current settings version** plus `version` itself (currently `3`). That covers policy, model, `model_kwargs`, prompt and board-display options, System 1 knobs, `draw_claims`, `seed`, and so on (`test_the_first_turn_records_the_setup_and_later_runs_keep_it` checks `setup["version"] == 3`).
- Because the settings are versioned, a recorded `setup` stays readable after the schema changes. Readers use `load_recorded` (Python) or `loadRecorded` (TypeScript, `packages/chess-ui/src/settings.ts`). Both require exactly the keys of the recorded version (otherwise the setup is "damaged") and then migrate it to the current version. `DEFAULTS` freezes each version's keys and defaults, and `MIGRATIONS` carries one version's keys to the next. This is why `ChessValues.setup` in `types.ts` is typed `unknown`, not `ChessContext`.
- It is written only by the run that opened the game's **first** turn: exactly one turn exists and its id equals `invocation.opened_turn`. It is never rewritten, so later runs with different settings leave it naming the first turn's settings.
- The middleware checks in both `before_agent` (so a first turn whose model call fails still has it) and `after_agent` (because a first command that lands on a finished position jumps from `ChessCore.before_agent` straight to the end, skipping later `before_agent` hooks).
- A rejected first input opens no turn and records no `setup`. A thread created before `setup` existed never gains one, even when its pending first turn is retried (`apps/server/tests/test_graph.py`).

The web UI's `gameOf` (`apps/web/src/setup.ts`) continues a game from the thread's recorded `setup`, read through `recordedContext` (a `loadRecorded` that returns `null` instead of throwing). Until the first turn records it, `gameOf` falls back to the context the human just chose for a new game. With neither, it returns `null` rather than guess a context, because a guessed one would play a different game.

### Why `messages` is not part of the record

`messages` is the model's working context, not a history of the game:

- **Commands don't always arrive as chat.** A position command becomes a synthesized "delta" `HumanMessage` (for example "New game. You are White." or "2. Nf3").
- **Messages get removed or added.** When a command is rejected, its chat message is deleted with `RemoveMessage`. When the model makes an illegal attempt, a feedback `HumanMessage` is added. Resignations and draw offers add a result or "Draw declined." `AIMessage`.
- **Some turns have no model reply.** A move from System 1, an extension or a forced move gets a synthesized `AIMessage("MOVE: <san>")`.
- **Summarization rewrites history.** With `memory="summarize"`, older messages are replaced. `Ply.message_id` is documented as "the committed AI message (it may since have been summarized away)".

So the durable facts about a move live on `Ply` and `TurnRecord`. Message ids stored there (`message_id`, `opened_message_id`, `rejected_message_ids`, `feedback_message_ids`) are cross-references only and may dangle. The UI's `ChessValues` still lists `messages` as optional, but only so it can stream the live reply. `liveAnalysis` in `packages/chess-ui/src/selectors.ts` finds the newest AI text after the pending turn's `opened_message_id` (or after the last human message when nothing is pending) and skips replies already committed to a ply.

### Why the private channels are not part of it

Some channels hold the working state of a single turn:

- `allowed_moves`, `candidates`, `candidates_by`, `proposal`, `fallback_move`
- `consumed_message_ids`, `terminal_intent`, `failed_call`, `invocation`

All are `PrivateStateAttr`. They are left out of both the input and output JSON schemas, and core resets the decision channels at every turn boundary (`_DECISION_RESET`: `proposal`, `terminal_intent`, `candidates`, `candidates_by`, `fallback_move`, `failed_call`). The catch is that the thread-state API (`get_state`, or the Agent Server's thread state endpoint) returns **every** channel, including these. That is why `RECORD_KEYS` exists and why the TypeScript `ChessValues` comment says "never read them".

Two of them are worth knowing as diagnostics, not as a client contract:

- `invocation` describes this run only: `action` is `execute`, `reject` or `noop`, and `opened_turn` is the id of the turn this run opened, or `None` for a retry, rejection or plain no-op (`test_the_invocation_names_only_a_turn_this_run_opened`). A command that lands on an already-finished position, and a resignation, record `noop` with `opened_turn` set to the terminal turn. `opened_turn` may be absent on older checkpoints. `GameSetupMiddleware` relies on it.
- `failed_call` marks a model call that failed after some provider calls had completed. Core keeps those completed calls and their time on the turn, and `after_model` re-raises the original error in the same run. The original exception is held only in the `ChessCore` instance's memory, so a resume (`invoke(None, …)`) finds no error to re-raise; it clears the marker and calls the model again instead of failing forever.

`position` is similar: it is `OmitFromOutput`, and core clears it to `None` on every run.

## Record shapes

```mermaid
erDiagram
    ChessState ||--o{ Ply : plies
    ChessState ||--o{ TurnRecord : turns
    ChessState ||--o{ DrawOffer : draw_offers
    TurnRecord ||--o{ Call : calls
    TurnRecord |o--o| Ply : "ply and turn_id"
```
*How the record links together: a committed turn points at its ply by index, a policy ply points back at its turn by id, and draw offers are a separate list keyed by ply count.*

**`Ply`**: one half-move.

- `ply` is the half-move's index. `side` is the side that moved.
- `uci` and `san` give the move in both notations.
- `source` is `"external"` for moves that came from input. Otherwise it is the proposal's source: `llm`, `systemone`, `forced`, or an extension's name.
- `analysis` holds the reply text for LLM moves.
- `message_id`, `turn_id` and `model` are all `null` on external plies, and their `latency_ms` is `0`.
- `latency_ms` is the owning turn's `latency_ms` at commit.
- `meta` holds per-middleware telemetry keyed by middleware name. For example, `meta["SystemOneMiddleware"]` holds System 1's shortlist and gate.

For an LLM move, `model` is the model of the turn's last `llm` call. For other sources it comes from `proposal.meta["model"]`. `ChessCore._finalize` builds the ply and gathers `meta` from each extension's `ply_meta()`. If the committed move itself ends the game, the same update sets `outcome` and adds a result message, and the turn stays `committed` (`test_threefold_is_not_adjudicated_before_the_agent_moves`).

**`TurnRecord`**: one attempt by the agent to move, or the record of a game-ending command.

- `id` identifies the turn.
- `request` is a fingerprint of the command that opened it: the chat message id, or `position:<sha256>` of the start FEN, the moves and the sorted `restrict`.
- `initial_allowed` is the legal moves intersected with `restrict`, taken when the turn opened. A retry restores it. It is `[]` on terminal turns.
- `status` is `pending`, `committed`, `abandoned` or `terminal`. `ply` is set only when the status is `committed`.
- `calls` lists every model call made during the turn, including calls that completed before a model call failed.
- `rejected_message_ids`, `feedback_message_ids` and `illegal_attempts` record illegal replies. Because the count lives on the durable turn, a retry after a provider error keeps the remaining illegal-move budget (`test_a_provider_error_retry_keeps_the_illegal_move_budget`). `opened_message_id` is the message that opened the turn.
- `latency_ms` is the summed model-call time, plus extensions' `turn_latency_ms()` added once when the turn finalizes.

Extensions' own calls (from `turn_calls()`) and time (from `turn_latency_ms()`) are folded into the turn by `ChessCore._finalized` exactly once: when it commits, becomes terminal, or is abandoned.

```mermaid
stateDiagram-v2
    [*] --> pending: new command accepted
    [*] --> terminal: command reaches a finished position or resigns
    pending --> committed: move finalized
    pending --> terminal: forfeit after retries
    pending --> abandoned: newer position or a resignation replaces it
    pending --> pending: retry after a failed run
```
*The lifecycle of `TurnRecord.status`. Only the last turn can be `pending`.*

**`Call`**: one provider response.

- `kind` is `llm`, `systemone` or `summary`. `model` is the canonical `provider:model`.
- Token counts: `input_tokens`, `output_tokens`, `reasoning_tokens`, `cache_read_tokens`, `cache_write_tokens`, and `cache_write_1h_tokens` (the 1-hour subset of cache writes).
- `called_at` is an ISO 8601 timestamp.
- Price fields: `cost_usd`, `cost_complete` (false if a usage dimension was approximated) and `priced_with` (the genai-prices version).

Unreported usage shows up as `null`. A provider that reports no token counts produces calls with `input_tokens: null` and `cost_usd: null` (`test_a_call_without_usage_has_no_cost`). A move costs its whole turn: `turn_cost` in Python, and its mirror `turnCost` in `selectors.ts`. Grading and review read the same shapes (see [grading and review](/openwiki/workflows/grading-and-review.md)).

### The TypeScript mirror

`packages/chess-ui/src/types.ts` is a hand-written copy of the Python state types (`Side`, `DrawReason`, `Outcome`, `DrawOffer`, `Call`, `TurnStatus`, `TurnRecord`, `Ply`, `PositionInput`, and `ChessValues` for the readable keys) and of the System 1 telemetry types (`SystemOneMeta`, `SystemOneLive`). Its header says: "Keep them in step by hand." Nothing generates or checks those types. **If you change a field in `state.py` or the System 1 telemetry types, change `types.ts` in the same commit.** Otherwise `apps/web` and `apps/review` will quietly misread threads. `ChessContext` and the settings enums are different: they are generated into `packages/chess-ui/src/generated/settings.ts` from the Python `ChessContext` by `mise run generate:settings`.

See [web frontends](/openwiki/architecture/web-frontends.md) for the code that uses these types. Selectors in `selectors.ts` rely on the record links described above:

- `turnOf` finds a ply's turn through `turn_id`.
- `lastPolicyPly` returns the last ply with a non-`external` source.
- `isPending` checks whether the last turn is `pending`.
- `turnCost` sums a turn's priced calls and marks the total incomplete if any call is unpriced or approximated.
- `rootAccepted` treats a root as taken once any turn exists.
- `drawMarks` turns `draw_offers` into the move-list positions to mark (`ply − 1`), treating a missing list as empty.

## Input: `messages` or `position`

The agent's input schema has exactly two properties, `messages` and `position` (`ChessInput`). A run carries **one** command:

- **A chat message**: the newest `HumanMessage`, if its id isn't in `consumed_message_ids`. Its text must be one of:
  - `go`, asking the agent to move;
  - a single legal move in SAN or UCI, recorded as an `external` ply before the agent replies (a promotion without its piece is rejected with the completed forms);
  - `resign <side>` or `draw <side>` (case-insensitive, one space). The side is named because the server doesn't know which side is human; it is not authenticated. Any other word after `resign` or `draw` is rejected with "name the side".

  Anything else is rejected as "neither `go` nor a legal move".
- **A `position`**: `{start_fen?, moves?, restrict?}`. `start_fen` defaults to the standard start, and `moves` are UCI moves from it. `restrict` is a hard limit on which moves the agent may consider, like UCI `searchmoves`. It must be non-empty and every entry must be legal in the resulting position. The allowed set is the legal moves intersected with `restrict`, kept in legal-move order (`test_restrict_narrows_the_turn`). If only one move is allowed, forced-move handling plays it (`source: "forced"`).

Sending both is rejected: "send a position or a message, not both".

### Resignation and draw offers

These chat commands open no model turn and are handled before the pending-turn check (`libs/chess/tests/test_commands.py`):

- **`resign <side>`** works for either side on either side's move. It abandons a pending turn (folding in extension calls and time) and discards any decision that turn had saved, so a validated move or a saved forfeit is not played. It then records a `terminal` turn with no calls, `ply: null`, `initial_allowed: []` and `request` and `opened_message_id` both set to the message id, sets a `Resignation` outcome with `reason: "resigned"` and the other side as winner, and adds a result message such as "White resigned · Black wins. 0-1". The run's `invocation` is `noop` with `opened_turn` set to the terminal turn.
- **`draw <side>`** is answered by the agent's draw policy (`decline_all` by default, so the answer is always `"declined"`). It must be offered on the offering side's own move ("offer a draw on your own move"), only once per side per position ("you already offered a draw in this position"), and not while a turn is pending ("finish or retry the pending turn first"). An accepted offer appends a `DrawOffer` to `draw_offers`, adds a "Draw declined." message, consumes the message, and changes nothing else. The run is a `noop`, and the game carries on.

Both can be a thread's first command, and both reset `error` to `null`.

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
    E -- no --> K{"resign or draw message?"}
    K -- resign --> RS["abandon pending, record terminal turn"]
    K -- draw --> DO["draw policy answers, append offer"]
    K -- no --> F{"pending and chat message?"}
    F -- yes --> R3["reject: finish or retry first"]
    F -- no --> G{"command valid and extends game?"}
    G -- no --> R4["reject with CommandError text"]
    G -- yes --> H["abandon any pending turn, open new turn"]
```
*How `before_agent` handles a run. Rejections set `error` and end the run without touching the game.*

The rules that follow from this:

- **Idempotent resubmission.** If the same command arrives again (same message id or same position fingerprint) after its turn committed, nothing happens. No model call is made and no turn is added (`test_same_chat_message_twice_is_a_noop`). If the turn is still pending, for example after a provider error, the resend retries it in place (`test_resent_position_retries_a_failed_turn`).
- **An empty run retries or does nothing.** `{}` or `{"messages": []}` retries a pending turn and is otherwise a no-op. Passing `None` as input resumes the checkpoint from the step that failed; on a finished checkpoint it runs nothing. A retry reuses a proposal or resignation intent that already passed validation instead of asking the model again.
- **A pending turn blocks new chat.** A new `go`, chat move or draw offer while a turn is pending is rejected ("finish or retry the pending turn first"), and the message is removed (`test_fresh_go_while_a_turn_is_pending_is_rejected`). A new *position* instead marks the pending turn `abandoned` (with extension calls and time folded in) and opens a fresh one (`test_new_position_abandons_a_pending_turn`). A resignation also abandons it, as described above.
- **The game must extend.** A position command is validated against the thread's game. With the thread's game called *G*, the rejections are:
  - `"a different starting position; use a new thread"`: *G* has moves and the root differs from its root.
  - `"invalid FEN …"` or `"invalid position: …"`: the root is invalid.
  - `"`<uci>` is not a legal move here"` or `"move N (uci) comes after the game ended (…)"`: a requested move is illegal, or follows an ending. The replay checks for an ending before every ply.
  - `"restrict must not be empty"` or `"restrict contains moves that are not legal here"`.
  - `"the position does not extend this game; use a new thread"`: the requested moves don't start with *G*'s `moves`. This also applies when the only change is a new `restrict` on a shorter move list (`test_same_root_with_a_new_restriction_is_rejected_as_diverged`).
- **Takebacks and new games need a new thread.** The UCI adapter checks this itself (`_thread_extends`: same normalized root and the GUI's moves start with the thread's `moves`) and, when the GUI's position doesn't extend the current thread, replaces it with a fresh thread and deletes the old one from its checkpointer. It filters `searchmoves` to the legal moves and reports the dropped ones, so it never widens the restriction. If every `searchmoves` entry is illegal it sends an empty `restrict`, which the agent rejects.
- **Finished games are closed.** Once `outcome` is set, every command, including another resignation, is rejected with "the game is over" and empty runs are no-ops. This check comes before any replay, because a resignation can't be worked out again from the board.
- **Terminal positions don't call the model.** If a command's position is already checkmate or an automatic draw, or with `draw_claims="auto"` a threefold repetition or fifty-move draw that has actually happened, a `terminal` turn is recorded along with the outcome and a result message, and the run ends as `noop` with `opened_turn` set. The model is never called (`test_terminal_positions`, `test_chat_move_that_mates_ends_the_game`). Draws the next move could claim are never adjudicated early (`rules.ending`).
- **Exhausted retries forfeit.** After `max_retries` feedback rounds, the next illegal reply sets a resignation intent with `reason: "illegal_moves"`; finalization records the `Resignation` outcome and marks the turn `terminal` with `ply: null` (`test_exhausted_retries_resign`).

A rejection writes only `error`, `invocation` and the cleared `position`, plus the empty record on a first run. `moves`, `plies` and `turns` stay as they were. Without a checkpointer the agent is stateless: every run starts a new game from its own input (`test_stateless_agent`).

## Changing the record safely

- New public fields go on `ChessState` with `OmitFromInput`, and in `RECORD_KEYS` if clients should read them. Mirror them in `types.ts`. If older threads won't have the key, say how to read its absence, as `draw_offers` does ("read it as `[]`"), and seed it in `_first_run`. A deployment-specific public key can instead live on a middleware's own state schema, as `setup` and `systemone_live` do, if it is `OmitFromInput` and documented for clients.
- Extension-specific data belongs in `Ply.meta[<middleware name>]` through `ply_meta()`, or in `TurnRecord.calls` and `latency_ms` through `turn_calls()` and `turn_latency_ms()`. Don't add new top-level record keys for it. An extension's own state keys should be `PrivateStateAttr`. The write guard rejects extension writes to core-owned keys ("core-owned") and only allows writes to `allowed_moves`, `proposal`, `fallback_move` and `candidates`.
- `libs/chess/tests/test_lifecycle.py` is the behavioural spec for schemas, no-ops, retries, rejections and terminal positions. `libs/chess/tests/test_commands.py` covers resignation and draw offers. `apps/server/tests/test_graph.py` covers when `setup` is (and isn't) recorded.
