---
type: concept
title: Prompt and memory
description: How ChessCore builds each move request from a filtered view of stored messages plus a freshly rendered position block, how show_legal_moves and candidates appear in it, what memory none/summarize let the model see, how ChessSummarization is configured and validated (including the shared chat_model input-limit profiles and the summarize eligibility check), and how context overflow becomes ContextBudgetError.
tags: [prompt, memory, summarization, model-view, context-window, langchain-chess]
verified:
  - by: openwiki/0.6.0
    at: 2026-09-26T13:04:36.303Z
sources:
  - id: openwiki-source-b9886f4aee6bc16bdaea61ff
    resource: repo://apps/server/langchain_chess_server/app.py
  - id: openwiki-source-65aad166aa88a58cc7a8319a
    resource: repo://apps/server/langchain_chess_server/context.py
  - id: openwiki-source-c9b903d37e22daedc4499a4b
    resource: repo://apps/server/langchain_chess_server/graph.py
  - id: openwiki-source-08efc3f1935724156208ec17
    resource: repo://apps/server/tests/test_graph.py
  - id: openwiki-source-5e8cfa6ef22542c9ea8aaf4a
    resource: repo://docs/decisions.md
  - id: openwiki-source-3ae14faf8cc85a90b40ed182
    resource: repo://libs/chess/langchain_chess/agent.py
  - id: openwiki-source-65bee4ff16ecbe51243c1e47
    resource: repo://libs/chess/langchain_chess/chat_models.py
  - id: openwiki-source-fc393bc7c06df7c3f85ece92
    resource: repo://libs/chess/langchain_chess/middleware/core.py
  - id: openwiki-source-4a4d83b98e02f02b6b258e76
    resource: repo://libs/chess/langchain_chess/middleware/summarization.py
  - id: openwiki-source-c79cd4ef1f60f33f3f30297b
    resource: repo://libs/chess/langchain_chess/parse.py
  - id: openwiki-source-6c9b823f6aaa5fb3802d7fae
    resource: repo://libs/chess/langchain_chess/pricing.py
  - id: openwiki-source-e92c3d9adb77a4ffddf28116
    resource: repo://libs/chess/langchain_chess/prompt.py
  - id: openwiki-source-4611e49b3e9b4d2d0edd598c
    resource: repo://libs/chess/tests/test_lifecycle.py
  - id: openwiki-source-cf546b381674f1176d137cb6
    resource: repo://libs/chess/tests/test_memory.py
  - id: openwiki-source-485da67626463e234bbc471c
    resource: repo://libs/chess/tests/test_text.py
  - id: openwiki-source-595fa5f62bc6bdbfd212eed8
    resource: repo://libs/cli/langchain_chess_cli/options.py
generated: { by: "openwiki/0.6.0", at: "2026-09-26T13:04:36.303Z" }
---

# Prompt and memory

Every LLM call the chess agent makes is built in one place: `ChessCore._prepare`, which runs inside `ChessCore.wrap_model_call` ([core.py](/libs/chess/langchain_chess/middleware/core.py)). It replaces the request's messages with:

1. `model_view(messages, turns, memory)`: a filtered, deep-copied view of the stored conversation, and
2. one trailing `HumanMessage` produced by `render_position(...)`: the current position, which is **never stored**.

The system prompt (`SYSTEM_PROMPT`, or `system_prompt=` passed to `create_chess_agent`) is set by `create_agent` and is unaffected. All the wording lives in [prompt.py](/libs/chess/langchain_chess/prompt.py). That module is pure, and its docstring asks that wording changes be deliberate and come with rendered-prompt tests. For where this fits in a run (turn opening, retries, finalization), see [turn lifecycle](/openwiki/architecture/turn-lifecycle.md). For the fields referenced below (`turns`, `plies`, `allowed_moves`, `candidates`, `consumed_message_ids`), see the [state record](/openwiki/concepts/state-record.md).

```mermaid
flowchart TD
    S["state: messages, turns, plies, allowed_moves, candidates"] --> V["model_view by memory mode"]
    S --> R["render_position"]
    V --> M["request messages"]
    R -->|"trailing HumanMessage, not stored"| M
    SUM["ChessSummarization.before_model (summarize only)"] -->|"may rewrite stored messages first"| S
    M --> H["handler: the LLM call"]
    H -->|"overflow-looking error"| E["ContextBudgetError"]
```

*How one move request is assembled. Summarization, when on, rewrites stored `messages` before `wrap_model_call` reads them.*

## What is stored vs. what is rendered

Stored `messages` hold only a small working conversation:

- **Opening message of a turn.** For a chat command this is the human's own message (`go`, `e4`, …). For a `position` command, core writes a short delta built by `delta_text`: `New game. You are White.` on a fresh thread, the new movetext since the last turn (for example `1... c5`), or `Your move as Black.` when nothing new was played. The turn record keeps its id in `opened_message_id`.
- **Model replies**, including reasoning blocks (kept for tracing). A reply with no text is stored as the placeholder `[no text in reply]` (`EMPTY_REPLY`), keeping its id and usage metadata.
- **Retry feedback** (`feedback_text`): `Try again, that move was rejected: <reason>. Choose from: <allowed SAN>. …`, or, when the reply was the empty placeholder, a variant that says the output budget was probably spent on reasoning. Feedback and rejected reply ids are tracked per turn in `feedback_message_ids` and `rejected_message_ids`.
- **Result messages** and, in `summarize` mode, the summary message.

Board state never lives in the conversation. The position block is rebuilt from `start_fen`, `plies` (SAN), the replayed board, `allowed_moves` and `candidates` on every call, including retries within a turn. So the model always sees the current position, whatever memory mode dropped or summarized.

## The position block (`render_position`)

Lines, in order:

1. `Moves so far: <movetext>` (numbered from any root FEN), or `(none, this is the first move)`.
2. `FEN: …`
3. The ASCII board in a code fence (ranks 8 to 1, uppercase is White).
4. `White to move.` / `Black to move.` and, if applicable, `You are in check.`
5. **Candidates.** `Suggested candidates: <SAN list>. These are suggested candidates; you may play any allowed move.` Only candidates still in `allowed_moves` are shown. The intersection is computed at render time, so if a later extension narrows the allowed set further, no stale candidate shows up. If nothing survives, the line is left out.
6. **Move list.** Exactly one of these, or neither:
   - `Only these moves are permitted: …` whenever `allowed_moves` differs from the full legal set (a `position.restrict`, or narrowing by middleware). This line appears **regardless of `show_legal_moves`**, because the model would otherwise try moves it cannot play.
   - `Legal moves: …` when nothing is restricted and `show_legal_moves=True` (the default).
   - Nothing when unrestricted and `show_legal_moves=False`.
7. `Reply with your analysis, then the final line \`MOVE: <move>\`.`

`candidates` are soft suggestions. In practice `SystemOneMiddleware` writes them when it doesn't play a move itself, and the write guard allows only one writer per turn. They are reset whenever a turn opens, retries from scratch or finalizes. See the [middleware contract](/openwiki/concepts/middleware-contract.md).

## The model view (`model_view`) and memory modes

`memory` is a `create_chess_agent` argument that `ChessCore` passes to `model_view`. It is typed `Literal["none", "summarize"]` and defaults to `"none"`. Rules shared by both modes:

- Only `HumanMessage` and `AIMessage` pass through.
- **Current turn:** every feedback message is kept, but among its rejected replies only the latest is shown. Earlier rejected attempts are hidden, so a third attempt sees the opening message, the feedback lines and the newest bad reply.
- **Reasoning blocks** (`reasoning`, `thinking`, `redacted_thinking`) are stripped from every AI message except the current turn's latest rejected reply. Stored messages keep them.
- Every returned message is a `copy.deepcopy`, so wrappers further in that mutate messages can't reach checkpointed state.

| Mode | What precedes the position block |
|---|---|
| `none` (default) | Only the current turn: messages from `opened_message_id` onward. Earlier turns are invisible, so the position block carries all context. |
| `summarize` | The whole stored conversation, minus the rejected replies and feedback of **earlier** turns, so what remains is a clean record of opening messages and accepted replies. `ChessSummarization` may have compacted that conversation into a leading summary message plus recent messages. Until the trigger fires, the model sees every earlier turn's opening and accepted reply. |

`model_view` handles `summarize` as "everything except earlier turns' failures". The summarization itself happens only in `ChessSummarization`, which rewrites stored `messages`.

### The removed `full` mode

There used to be a third mode, `full`, which showed every earlier turn verbatim with no compaction. It has been removed: `Memory` no longer includes it, and the server's `ChessContext` rejects `memory="full"` with a validation error. The measurements behind that decision (prompt size per move, and analysis length under `none` vs. `full`) are recorded in [docs/decisions.md](/docs/decisions.md).

### Adapter knobs

Adapters pin the mode when there is no LLM: the server graph ([graph.py](/apps/server/langchain_chess_server/graph.py)) and the CLI ([options.py](/libs/cli/langchain_chess_cli/options.py)) force `memory="none"` when `policy="systemone"`. The server exposes `memory` (default `none`, described as "the conversation summarized at 70% of the model's input limit", needing a model with a known input limit, and ignored for `systemone`) and `show_legal_moves` as `ChessContext` knobs ([context.py](/apps/server/langchain_chess_server/context.py)). The CLI's `AgentOptions` mirror them with the same defaults, and the UCI engine advertises a `Memory` combo option (`none` / `summarize`). Neither adapter has a summary-trigger knob.

## ChessSummarization

[summarization.py](/libs/chess/langchain_chess/middleware/summarization.py) subclasses LangChain's `SummarizationMiddleware`. It keeps the stock trigger and cutoff logic and adds chess-specific accounting and validation.

**Placement.** `create_chess_agent` appends it only when `memory="summarize"`, and always **last** in the stack ([agent.py](/libs/chess/langchain_chess/agent.py)). It is core-owned and not wrapped by the write guard, and it is the only middleware allowed to rewrite `messages`. Because it runs last in `before_model`, it runs only when a real LLM call is about to happen. When System 1 proposes a move or the forced-move shortcut applies, the run jumps to the end before it runs. Its `name` property returns `"SummarizationMiddleware"`, so graph node names (for example `SummarizationMiddleware.before_model`) stay stable.

**Fixed topology.** With `fixed_topology=True` and `memory="none"`, `create_chess_agent` appends `NoSummarization` in the same slot instead. It has the same name and its `before_model` hooks do nothing, so the graph has the same nodes whatever the memory setting. The server builds every graph with `fixed_topology=True` because the Agent Server reads and updates thread state with a graph built without the run's settings. The CLI does not set it.

**Defaults.**

- `trigger = ("fraction", 0.7)` of the model's input limit, which leaves room for the system prompt, the position and the output.
- `keep = ("messages", 20)`.
- `summary_prompt = CHESS_SUMMARY_PROMPT`. It asks the model to keep plans, threats, opponent tendencies and open questions. It also tells the model to ignore rejected moves and retry feedback, and not to list moves or describe the board, since the position is shown on every turn.

**Construction-time checks** (each raises `ChessContractError`):

- `memory="summarize"` with `model=None` fails with the message "needs a model".
- `summary_prompt` must contain `{messages}`.
- `keep` must be `("messages", n)` with `n >= 2 * max_retries + 2`, which is 8 for the default `max_retries=3`. The stock cutoff counts messages and knows nothing about turns. This floor guarantees that one turn's opening message, every attempt and every feedback line can all be kept. Token-based `keep` values are rejected.
- **Profile requirement.** A fractional trigger needs the model's `max_input_tokens`, which `input_limit(model)` reads from `model.profile`. If the stock constructor raises `ValueError` (no profile), the error is re-raised as `ChessContractError` with a hint: give the model `profile={'max_input_tokens': ...}`, pass `summarization` with an absolute trigger, or use `memory='none'`.

**Configuring it in the library.** Pass a preconfigured `SummarizationMiddleware` as `create_chess_agent(summarization=...)`. `ChessSummarization.from_middleware` copies its public settings (`trigger`, `keep`, `summary_prompt`, `trim_tokens_to_summarize`, `token_counter`), and the checks above still apply. Tests use this route to set small message-count triggers.

## Input limits and the summarize eligibility check

The server and CLI never pass `summarization=`, so deployed games always use the fractional default of 70% of the input limit. That makes a correct `max_input_tokens` essential. Both adapters now build their chat model with the same shared factory, `chat_model(model, reasoning_effort)` in [chat_models.py](/libs/chess/langchain_chess/chat_models.py). The server's `chat_model(context)` and the CLI's `default_model(options)` are thin wrappers around it. The factory sizes the output budget and the input limit together:

- **Output budget.** `output_budget(window, ceiling)` is `MAX_TOKENS = 64000` (reasoning included), capped by the model's own output limit when known and by half of a small context window. For example, `langsmith:openai/gpt-4` with an 8192-token window gets `max_tokens = 4096`.
- **Gateway (`langsmith:`) models.** The gateway's `ChatOpenAI` ships without a profile, so the factory reads `context_window(model)` from the pricing snapshot ([pricing.py](/libs/chess/langchain_chess/pricing.py)). That window counts input and output together. The output ceiling comes from the vendor's own LangChain profile, when that integration is installed. If the window is known, the model gets `profile={"max_input_tokens": window - budget}` (for example `1_048_000 - 64000` for the default GLM model). If it is unknown, there is no profile.
- **Native providers.** The factory keeps the provider's own profile but may lower its `max_input_tokens` to `min(native max_input_tokens, window - budget)`, so the summarize schedule leaves room for the output budget. For a bare spec, the window falls back to the native profile's `max_input_tokens`.

**Eligibility check.** Before calling `create_chess_agent`, both adapters' `build_agent` reject `memory="summarize"` with a `ChessContractError` ("has no known input limit … use memory='none'", or `use memory none` in the CLI's wording) when `input_limit(model)` is `None`. A `systemone` policy is exempt, because it has no model and its memory is already forced to `none`. `memory="none"` with the same unknown model builds fine.

The server also serves `GET /ui/model-limit?model=…` ([app.py](/apps/server/langchain_chess_server/app.py)), backed by the cached `model_limit()` helper in `graph.py`. It builds the same chat model and returns its `input_limit` (or `None` if the model can't be built). The new-game dialog offers `summarize` only when that value is known.

See [models, gateway and cost](/openwiki/concepts/models-gateway-and-cost.md).

## Summary accounting

`before_model`/`abefore_model` run the stock hook inside `recorder.sink("summary")`. If the stock hook returns a rewrite, `_account`:

- appends the summary's own provider calls (kind `summary`) to the current turn's `calls` **in the same state update as the rewrite**, so the summary and its cost are checkpointed together;
- gives any id-less `HumanMessage` in the rewrite (the summary) a UUID and adds it to `consumed_message_ids`, so core's lifecycle never mistakes it for a new chat command.

Consequences, verified in [test_memory.py](/libs/chess/tests/test_memory.py):

- A turn's calls can read `["summary", "llm"]`, or `["llm", "summary", "llm"]` when a retry within the turn pushes the conversation over the trigger.
- If the model call after a summary fails, the rewrite and the `summary` call are already checkpointed, and the turn stays pending.
- Concurrent stateless runs each record their own summary.
- After a rewrite in the middle of a turn, the current turn's opening message may be summarized away, but the newest attempt and its feedback survive, and the retry still ends with the position block.

Whether summary calls actually fire in deployed games is a runtime question. See [runtime behavior](/openwiki/operations/runtime-behavior.md) for observed call kinds per turn.

## Overflow detection

`wrap_model_call` and `awrap_model_call` catch exceptions from the handler. If the lowercased error text contains any of `prompt is too long`, `context length`, `context_length`, `maximum context`, `too many tokens` or `input is too long` (`looks_like_overflow`), the exception is re-raised as `ContextBudgetError` (exported from `langchain_chess`), chained to the original. Other exceptions propagate unchanged. If some provider calls had already completed in that model call, core first records them on the turn (with a `failed_call` marker) and re-raises the same error from `after_model`, so the cost is kept. Either way the turn stays `pending`, so a later run with no new command retries it. Detection is a heuristic based on provider error strings, so a provider with different wording produces a plain error. Summarization is the proactive defence, and this error is the reactive signal.

## Measurements

[docs/decisions.md](/docs/decisions.md) records the choices here that look like gaps, with their numbers. Anthropic prompt caching was not shipped: the gateway's single request-level breakpoint lands on the per-turn position block, and prompts are small (about 520 input tokens per move with `memory="none"`). It also records the memory-mode comparison that preceded removing `full`. Read the numbers there, since they change.

## Tests that matter

- [test_text.py](/libs/chess/tests/test_text.py): exact rendered text of `render_position` (legal list, hidden list, candidates ∩ allowed, the permitted-only line, check), `delta_text`, `feedback_text`, and `model_view` for `none` and `summarize` (hidden attempts, earlier turns' failures dropped, reasoning stripping, deep copies).
- [test_memory.py](/libs/chess/tests/test_memory.py): summarization rewrites during a turn and on a retried turn, the keep floor and prompt checks, `input_limit` reading the profile, a profileless model failing and a profiled one getting the `SummarizationMiddleware.before_model` node, a fixed topology keeping a summarization node that never summarizes, call ordering and checkpointing of `summary` calls, and what `summarize` memory shows across turns before any summary fires.
- [test_graph.py](/apps/server/tests/test_graph.py): every policy × memory setting builds the same topology as a read graph (including the summarization node). Gateway profiles are `window - 64000`, and a small window is split in half. `summarize` builds for gateway and native models with known limits and is rejected for an unknown-limit model (but not under `systemone`). `memory="full"` is rejected, and `model_limit` agrees with the agent.
- [test_lifecycle.py](/libs/chess/tests/test_lifecycle.py): `memory="none"` sees only the current turn, an empty reply is stored as the placeholder and triggers the reasoning-budget feedback, and `ContextBudgetError` leaves the turn pending.
