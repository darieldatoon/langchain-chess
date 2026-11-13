---
type: Concept
title: Prompt and memory
description: What the chess LLM reads on every call (system prompt, stored messages filtered by model_view, one never-stored per-turn position message), the on/off memory switch, and how ChessSummarization triggers from the model's input limit, including the GET /model-facts lookup the web UI uses before offering memory.
tags: [prompt, memory, summarization, position-message, model-view, input-limit, model-facts]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-13T19:10:14.398Z
sources:
  - id: openwiki-source-b9886f4aee6bc16bdaea61ff
    resource: repo://apps/server/langchain_chess_server/app.py
  - id: openwiki-source-c9b903d37e22daedc4499a4b
    resource: repo://apps/server/langchain_chess_server/graph.py
  - id: openwiki-source-af9ed044b3462b6126b95a6e
    resource: repo://apps/server/README.md
  - id: openwiki-source-08efc3f1935724156208ec17
    resource: repo://apps/server/tests/test_graph.py
  - id: openwiki-source-3ae14faf8cc85a90b40ed182
    resource: repo://libs/chess/langchain_chess/agent.py
  - id: openwiki-source-65bee4ff16ecbe51243c1e47
    resource: repo://libs/chess/langchain_chess/chat_models.py
  - id: openwiki-source-2823ab4258a02b653101a66b
    resource: repo://libs/chess/langchain_chess/contract.py
  - id: openwiki-source-ddd9015cc3a195fb1a1753fe
    resource: repo://libs/chess/langchain_chess/errors.py
  - id: openwiki-source-fc393bc7c06df7c3f85ece92
    resource: repo://libs/chess/langchain_chess/middleware/core.py
  - id: openwiki-source-4a4d83b98e02f02b6b258e76
    resource: repo://libs/chess/langchain_chess/middleware/summarization.py
  - id: openwiki-source-c79cd4ef1f60f33f3f30297b
    resource: repo://libs/chess/langchain_chess/parse.py
  - id: openwiki-source-e92c3d9adb77a4ffddf28116
    resource: repo://libs/chess/langchain_chess/prompt.py
  - id: openwiki-source-cbaaf1981eee0f537632c225
    resource: repo://libs/chess/langchain_chess/settings.py
  - id: openwiki-source-2c6a2617bc273a5be95fdd7d
    resource: repo://libs/chess/tests/test_contract.py
  - id: openwiki-source-4611e49b3e9b4d2d0edd598c
    resource: repo://libs/chess/tests/test_lifecycle.py
  - id: openwiki-source-cf546b381674f1176d137cb6
    resource: repo://libs/chess/tests/test_memory.py
  - id: openwiki-source-485da67626463e234bbc471c
    resource: repo://libs/chess/tests/test_text.py
  - id: openwiki-source-abe54986bd51a87223916132
    resource: repo://libs/cli/langchain_chess_cli/main.py
  - id: openwiki-source-1dd02340acf0ca7c8c33f18b
    resource: repo://libs/cli/langchain_chess_cli/uci/engine.py
  - id: openwiki-source-c228b1f5ddeb31cb2374ed59
    resource: repo://libs/systemone/langchain_chess_systemone/agent.py
  - id: openwiki-source-21de6a067affac443ab60933
    resource: repo://libs/systemone/langchain_chess_systemone/settings.py
  - id: openwiki-source-95af6ce374db999cf2c4a7e0
    resource: repo://libs/systemone/tests/test_agent.py
generated: { by: "openwiki/0.9.0", at: "2026-11-13T19:10:14.398Z" }
---

# Prompt and memory

Every model call sees the same three things in the same order: the system prompt, a filtered
view of the stored conversation, and one trailing position message that is built fresh for the
turn and never stored. Memory decides how much of the stored conversation the view keeps. When
memory is on, a summarization middleware stops that conversation from outgrowing the model's
input limit.

Measurements behind these choices, such as prompt sizes per move and why there is no prompt
caching or `full` memory mode, are on [Decisions and measurements](decisions.md). Model
construction, output budgets and gateway profiles are covered in
[Models, gateway and cost](models-gateway-and-cost.md).

## System prompt

`SYSTEM_PROMPT` in `libs/chess/langchain_chess/prompt.py` asks for a legal move in SAN, given
on a final `MOVE: <move>` line. `system_prompt` is a `CoreSettings` field on every surface.
`None` keeps the bundled prompt. An empty string is rejected with `ChessContractError`. When
memory is on, `create_chess_agent` also rejects a system prompt whose token count reaches a
summarization trigger threshold (`ChessSummarization.check_room`), because the agent would then
summarize before every call. With memory off, a long prompt is accepted.

## Per-turn position message

`ChessCore._prepare` builds every LLM request as `model_view(messages, turns, memory=...)`
followed by one trailing `HumanMessage` from `ChessCore.turn_message`. That message renders a
`PositionView` through `render_position`. The position block is never written to stored
messages.

`render_position` always writes these core lines:

- the moves so far
- the starting FEN, if the start is not the standard position
- the side to move
- check, when the side to move is in check
- on restricted turns, the permitted moves
- the closing request for `MOVE: <move>`

The rest of the position block comes from a renderer. The bundled
`position_renderer(show_fen, show_board, move_list)` adds the FEN, an ASCII board and move
lists. Passing a custom `render_position=` replaces the bundled renderer, but the core lines
stay.

- `ChessCore.turn_message` first narrows candidates to those still in `allowed_moves`. The
  "Suggested candidates" line appears only when candidates exist and `move_list` is `both` or
  `candidates`. That includes restricted turns.
- When `allowed_moves` differs from the full legal set (`PositionView.restricted`), the message
  always says "Only these moves are permitted", whatever `move_list` is set to. The bundled
  "Legal moves" list appears only on unrestricted turns with `move_list` set to `both` or
  `legal`.

A position command opens a turn with a stored delta message from `delta_text`. On a fresh
thread it is `New game. You are <side>.`. Otherwise it is the movetext played since the last
turn, or `Your move as <side>.` if nothing new was played.

Retry feedback lists the allowed moves in SAN. A reply with no text is stored as the
placeholder `[no text in reply]`, keeping its id and usage. The feedback for that retry says the
output budget was probably spent on reasoning.

## Memory modes

`memory` is a strict boolean, `False` by default, on `create_chess_agent`, on `CoreSettings`
and on every `ChessContext` that inherits from it. There is no `full` mode, so string values
such as `'full'` fail validation. The UCI engine exposes `Memory` as a check option. It still
accepts the legacy values `summarize` and `none`, read as true and false.

`model_view` decides what the model sees from the stored messages:

- **Memory off:** only messages from the current turn's `opened_message_id` onward.
- **Memory on:** the whole stored conversation, minus the rejected replies and feedback from
  earlier turns.

In both modes:

- The current turn shows all of its feedback but only its latest rejected reply.
- Reasoning blocks are stripped from every other AI message.
- Only Human and AI messages pass through.
- The returned messages are deep copies, so wrappers cannot mutate state through them.

## Summarization

`create_chess_agent` appends `ChessSummarization` only when `memory=True`. It goes after core,
`ForcedMoveMiddleware` and all user middleware, so only `StallRetry` follows it. If no model is
given, it raises `ChessContractError("memory needs a model")`. With `fixed_topology=True` and
memory off, `NoSummarization` takes its place instead. Its `before_model` hooks do nothing, but
the graph keeps the same nodes for every memory setting. The server always builds with
`fixed_topology=True`, including the settings-free `shape()` graph it uses for reads. Both
middlewares report their name as `SummarizationMiddleware`, so node names such as
`SummarizationMiddleware.before_model` stay stable.

`ChessSummarization` defaults:

- `trigger`: `('fraction', 0.7)` of the model's input limit
- `keep`: `('messages', 20)`
- `summary_prompt`: `CHESS_SUMMARY_PROMPT`, which tells the summarizer to ignore rejected moves
  and retry feedback, and not to list moves or describe the board

Construction enforces these rules:

- `summary_prompt` must contain `{messages}`.
- `keep` must be `('messages', n)` with `n >= 2*max_retries+2`, so a turn's opening message,
  attempts and feedback can always be kept.
- A fractional trigger needs the profile's `max_input_tokens`, which `input_limit` reads.
  Without it, `ChessSummarization` raises `ChessContractError`. The error suggests adding a
  profile, passing a summarization middleware with an absolute trigger, or turning memory off.

The trigger counts more than the stored messages. It adds the system prompt and the turn's
position message as overhead. Trimming and the keep cutoff count stored messages only.

A preconfigured `SummarizationMiddleware` passed as `summarization=` is converted with
`ChessSummarization.from_middleware`. The conversion copies `trigger`, `keep`,
`summary_prompt`, `trim_tokens_to_summarize` and `token_counter`. The shared `build_agent`
that the server and CLI use never passes `summarization=`, so deployed games always use the
fractional default trigger.

The stock summarization hook runs inside a `summary` recorder sink and `provider_errors()`.
Its provider calls are recorded as kind `summary` on the current turn's calls, in the same
state update as the message rewrite. The summary `HumanMessage` has no id when it is created.
`ChessSummarization` gives it one and marks it consumed, so it is never treated as a command.

### Context overflow

`ChessCore`'s `wrap_model_call` runs the handler inside `errors.provider_errors()`. Exceptions
whose text matches overflow hints are re-raised as `ContextBudgetError`. The hints are "prompt
is too long", "context length", "context_length", "maximum context", "too many tokens" and
"input is too long". Provider 400 errors about the reasoning effort become
`ReasoningEffortError`. Other errors propagate unchanged, and the turn stays pending.

## Where the input limit comes from

Every surface builds its model with the single `chat_model` factory, through `build_agent`'s
`default_model` or the server's `server_model`. The factory sets the profile's
`max_input_tokens` from the model's context window minus its output budget. For
`langsmith:` gateway models this works only when the pricing snapshot knows the window. Native
profiles are capped at `min(native limit, window - budget)`. Details are on
[Models, gateway and cost](models-gateway-and-cost.md).

The shared `build_agent` rejects `memory=True` with `ChessContractError` ("no known input
limit, so it can't use memory") when the constructed model has no known input limit. The
exception is the `systemone` policy: it builds no model, so `build_agent` drops memory.

The web UI asks before offering memory. The server's `GET /model-facts?model=<spec>` route in
`apps/server/langchain_chess_server/app.py` returns `max_input_tokens` and `takes_effort`.
`max_input_tokens` comes from the cached `model_limit(model)`, which computes
`input_limit(default_model(ChessContext(model=model)))`. It is `None` when the model has no
known limit or cannot be built. The new-game dialog offers memory only for models with a known
input limit.
