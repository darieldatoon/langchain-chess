---
type: operations runtime evidence
title: Runtime behavior and failure modes
description: How a turn of the chess graph (deployed as langchain-chess-app) fails and recovers at runtime. Covers stalled-stream retries, provider errors, illegal-reply retries, the pending-turn resume path, System 1 ranking failures, settings validation, memory eligibility, the System 1 HTTP client pool's lifetime, what the web UI shows, and how to read LangSmith traces against the code.
tags: [runtime, failure-modes, retries, langsmith, traces, latency, operations, systemone, turn-lifecycle]
verified:
  - by: openwiki/0.6.0
    at: 2026-09-27T19:08:28.877Z
sources:
  - id: openwiki-source-b9886f4aee6bc16bdaea61ff
    resource: repo://apps/server/langchain_chess_server/app.py
  - id: openwiki-source-72cff634549a72fbc164bc15
    resource: repo://apps/server/langchain_chess_server/clients.py
  - id: openwiki-source-65aad166aa88a58cc7a8319a
    resource: repo://apps/server/langchain_chess_server/context.py
  - id: openwiki-source-c9b903d37e22daedc4499a4b
    resource: repo://apps/server/langchain_chess_server/graph.py
  - id: openwiki-source-e3b0d2af80ee0702b2be4a6b
    resource: repo://apps/server/langchain_chess_server/settings.py
  - id: openwiki-source-85a241004b3536de61fe173c
    resource: repo://apps/server/tests/test_clients.py
  - id: openwiki-source-1b589132a05fcfdecd7cc1d4
    resource: repo://apps/web/src/App.tsx
  - id: openwiki-source-63a59ecdfb2c0567127b7b6f
    resource: repo://apps/web/src/format.ts
  - id: openwiki-source-3cb426dd15d324cb1ef8679d
    resource: repo://apps/web/src/settings.ts
  - id: openwiki-source-611421396243f4b643f6d94a
    resource: repo://apps/web/src/useGame.ts
  - id: openwiki-source-3ae14faf8cc85a90b40ed182
    resource: repo://libs/chess/langchain_chess/agent.py
  - id: openwiki-source-65bee4ff16ecbe51243c1e47
    resource: repo://libs/chess/langchain_chess/chat_models.py
  - id: openwiki-source-fc393bc7c06df7c3f85ece92
    resource: repo://libs/chess/langchain_chess/middleware/core.py
  - id: openwiki-source-85ad0c871015c0f31a99e9a2
    resource: repo://libs/chess/langchain_chess/middleware/stall_retry.py
  - id: openwiki-source-4a4d83b98e02f02b6b258e76
    resource: repo://libs/chess/langchain_chess/middleware/summarization.py
  - id: openwiki-source-b97343132cd8bf8377dc9677
    resource: repo://libs/chess/langchain_chess/model_arguments.py
  - id: openwiki-source-cf036aa5f44c795ee62f143f
    resource: repo://libs/chess/langchain_chess/recorder.py
  - id: openwiki-source-cbaaf1981eee0f537632c225
    resource: repo://libs/chess/langchain_chess/settings.py
  - id: openwiki-source-2c6a2617bc273a5be95fdd7d
    resource: repo://libs/chess/tests/test_contract.py
  - id: openwiki-source-20ebabb38d27c2e3522a9062
    resource: repo://libs/cli/langchain_chess_cli/uci/completion.py
  - id: openwiki-source-c228b1f5ddeb31cb2374ed59
    resource: repo://libs/systemone/langchain_chess_systemone/agent.py
  - id: openwiki-source-3c3f476720af9ceef23b678d
    resource: repo://libs/systemone/langchain_chess_systemone/middleware.py
  - id: openwiki-source-79af0d552c660a058f4241b8
    resource: repo://libs/systemone/langchain_chess_systemone/ranker.py
  - id: openwiki-source-21de6a067affac443ab60933
    resource: repo://libs/systemone/langchain_chess_systemone/settings.py
  - id: openwiki-source-0e44d1e7d0101f3027cd3f67
    resource: repo://libs/systemone/tests/test_middleware.py
generated: { by: "openwiki/0.6.0", at: "2026-09-27T19:08:28.877Z" }
---

# Runtime behavior and failure modes

This page covers what happens at runtime when a turn of the `chess` graph goes wrong, and how
it recovers. It also explains how to read production traces in the LangSmith project
`langchain-chess-app` against the code. Static design is covered on these pages, and each of them
links back here for its runtime notes:

- [turn lifecycle](../architecture/turn-lifecycle.md): turn states, retries, finalization
- [System 1](../architecture/system-one.md): the gate, tournaments, frozen decisions
- [Agent Server adapter](../integrations/agent-server.md): graph factory, settings, deployment
- [models, gateway and cost](../concepts/models-gateway-and-cost.md)
- [decisions](../concepts/decisions.md): recorded measurements (prompt size, caching)
- [prompt and memory](../concepts/prompt-and-memory.md)

Statements carry one of three labels:

- **Observed:** read directly from sampled traces.
- **Correlated:** tied to source code this page cites.
- **Hypothesis:** a change or check that still needs verifying.

## Status of trace evidence

- **Observed:** none. The LangSmith sample for this refresh could not be read from this worker
  (no raw-item access), so the page still reports **no** trace counts, latencies, token totals or
  error signatures. Everything below comes from the code (**Correlated**). None of it is a
  production measurement, and the sample shows no failing traces only in the sense that none
  were available to inspect.

## Failure map at a glance

```mermaid
flowchart TD
  Run["Run starts"] --> Ctx{"resolve_context validates settings"}
  Ctx -- invalid --> Fail1["Run fails before any turn opens"]
  Ctx -- ok --> Build{"build_agent"}
  Build -- "memory without input limit" --> Fail2["ChessContractError"]
  Build -- "System 1 creds missing" --> Fail3["ValueError from settings"]
  Build -- ok --> Life["ChessCore opens or resumes a turn"]
  Life --> S1{"System 1 ranks"}
  S1 -- "RankingFailed, hybrid" --> Skip["skipped, LLM plays unaided"]
  S1 -- "RankingFailed, systemone policy" --> Pend["Run fails, turn stays pending"]
  S1 -- "played" --> Commit["Finalize and commit"]
  S1 -- shortlist --> LLM{"Model call"}
  Skip --> LLM
  LLM -- "stream stall, first time" --> LLM
  LLM -- "second stall or provider error" --> Pend
  LLM -- overflow --> Budget["ContextBudgetError, turn pending"]
  LLM -- "illegal reply, budget left" --> LLM
  LLM -- "illegal reply, budget spent" --> Resign["Resign with illegal_moves"]
  LLM -- "legal reply" --> Commit
  Pend --> Retry["Empty submit resumes the turn"]
  Budget --> Retry
  Retry --> Life
```

*Where a run can fail, and which failures leave a pending turn that an empty submit resumes.*

## Before a turn: settings validation and graph construction

- **Settings resolution.** `resolve_context` (`apps/server/langchain_chess_server/context.py`)
  reads the assistant's `context` first and then `config["configurable"]`. Each source is
  migrated to the current settings `VERSION` with unknown keys dropped (the server puts its own
  keys in `configurable`), and a source without `version` is read as the current one.
  `resolve` (`libs/systemone/langchain_chess_systemone/settings.py`) merges them, later source
  winning, and removes explicit nulls, so a null resets that setting to its default (every
  nullable setting defaults to null). The merged values are then validated by the strict
  `ChessContext` model, so a mistyped or out-of-range setting fails the run up front, before any
  turn opens. The graph's context schema, `ChessContextInput`, is deliberately lenient: LangGraph
  does not validate it, which lets an assistant saved by an older version still run.
- **Defaults.** `ChessContext` defaults to policy `hybrid`, model
  `langsmith:baseten/zai-org/GLM-5.3-Flash` with no `reasoning_effort` and empty `model_kwargs`,
  `memory` off, `threshold=0.9` with the `margin` gate, `tournament_threshold` unset, `k=5`,
  `systemone_model="semif-qwen3.5-4b"`, and `with_eval` and `with_nouls` off.
- **Policy shapes.** `build_agent` (`libs/systemone/langchain_chess_systemone/agent.py`) builds
  no chat model for `policy="systemone"`, so memory is ignored, and that policy's
  `SystemOneMiddleware` gets both thresholds set to 0 and `has_model=False`, so System 1 always
  plays. `policy="llm"` gets `NoSystemOne` on the server (which builds with
  `fixed_topology=True`), keeping the node but ranking nothing.
- **Server model arguments.** The server builds the model with `surface="server"`
  (`server_model` in `graph.py`), which holds back more of `model_kwargs` than local surfaces:
  only an allowlist of request arguments passes (`libs/chess/langchain_chess/model_arguments.py`).
- **Credentials.** Any policy that runs System 1 calls `ServerSettings.typesafe()`, which raises
  `ValueError` if `TYPESAFE_API_KEY` or `TYPESAFE_BASE_URL` is missing. A variable that is set
  but blank is also rejected, so a blank gateway key never silently falls back to the tracing key
  (`apps/server/langchain_chess_server/settings.py`).
- **Reads never build a runnable agent.** When the server calls `make_graph` without an execution
  runtime (to read or update state, or to describe the graph), it returns `shape()`. That graph
  has every node switched off and needs no model, clients or credentials.

## Memory eligibility

- Summarization runs only with `memory=True` (a boolean since settings version 2).
  `create_chess_agent` appends `ChessSummarization` only then; with `fixed_topology` it appends a
  no-op `NoSummarization` that keeps the graph shape. The default is `memory=False`, so under
  default settings no summary calls happen.
- The trigger is 70% of the model's input limit (`DEFAULT_TRIGGER = ("fraction", 0.7)`), counting
  the system prompt and the turn's message. At least `2 * max_retries + 2` recent messages are
  kept so one turn's attempts survive.
- `chat_model` (`libs/chess/langchain_chess/chat_models.py`) gives gateway models a profile
  whose `max_input_tokens` is the known context window minus the output budget. `build_agent`
  raises `ChessContractError` when memory is on for a model that has no known input limit, and
  `ChessSummarization.check_room` rejects a system prompt that alone reaches the trigger.
- The web dialog asks `GET /ui/model-limit` (backed by the cached `model_limit` in `graph.py`) and
  offers memory only when a limit is known (`apps/server/langchain_chess_server/app.py`).
- Summary calls run in `before_model`, outside `ChessCore.wrap_model_call`. Their `Call`s go
  onto the turn record together with the message rewrite, but their time does not count toward
  `turn.latency_ms`.

## During a turn: model errors, retries and resume

```mermaid
stateDiagram-v2
  [*] --> pending: turn opens
  pending --> pending: illegal reply, feedback added
  pending --> committed: legal proposal finalized
  pending --> terminal: resignation or game end
  pending --> abandoned: new position request supersedes it
  pending --> pending: run fails, empty submit resumes
  committed --> [*]
  terminal --> [*]
  abandoned --> [*]
```

*Turn status transitions that matter for failure handling. A failed run leaves the turn `pending`.*

- **Stalled response streams.** `StallRetry` (`libs/chess/langchain_chess/middleware/stall_retry.py`)
  is a `ModelRetryMiddleware` with `max_retries=1`, `initial_delay=0` and `on_failure="error"`.
  It retries only what `stall_errors()` returns: `langchain_openai.StreamChunkTimeoutError`
  (every `langsmith:` gateway model is a `ChatOpenAI`), or nothing when `langchain_openai` is not
  installed. It sits inside `ChessCore.wrap_model_call`, so a retry repeats only the provider
  call, in the same turn, without an illegal-reply feedback message. A stalled attempt records no
  `Call`, because usage would have arrived in the final chunk. A second stall re-raises, and the
  run fails with the turn pending. Per the module's comment, each stall has already waited out
  langchain-openai's 120 s chunk timeout, so a double stall can hold a turn for about four minutes
  before the web shows Retry (arithmetic from the comment, not a measurement).
- **Illegal or unparseable replies.** `ChessCore._parse` rejects a reply that has no parseable
  move or names a move outside `allowed_moves`. While `illegal_attempts < max_retries` (default
  3, `create_chess_agent`) it appends a feedback message and jumps back to the model. After that
  it sets a resignation `terminal_intent` with reason `illegal_moves`. The counter is stored on
  the durable turn record, so a resume after a provider error keeps the remaining budget. A turn
  therefore gets at most four parsed replies. An empty reply is replaced with `EMPTY_REPLY` so the
  feedback can say the reply was empty.
- **Provider errors.** If the model call raises (after `StallRetry` gives up, or for any
  non-stall error) before any response has been recorded, the error propagates and the run fails
  with the turn still `pending`.
- **Errors after a completed call.** If a wrapper inside the model call records a response and
  then fails, `wrap_model_call` keeps the completed `Call`s on the turn and writes a
  `failed_call` marker. `after_model` then re-raises the original error in the same run. The
  error itself is kept only in the middleware instance's memory. A later resume does not have it,
  so it clears the marker and calls the model again instead of re-raising forever.
- **Context overflow.** A provider exception whose text looks like context overflow ("prompt is
  too long", "context length", and so on) is re-raised as `ContextBudgetError`. This also applies
  when it happens after a call has completed. The turn stays pending.
- **Resume.** An empty submit with a pending turn goes to `ChessCore._retry`. If a validated
  `proposal` or `terminal_intent` is already in state, the run jumps straight to finalization
  and does not call the model again. Otherwise it clears the decision fields and restores
  `allowed_moves` from `initial_allowed`. A new chat message while a turn is pending is rejected
  with "finish or retry the pending turn first". A new `position` request abandons the pending
  turn and opens a fresh one.
- **Forced moves.** When the turn opened with exactly one legal move, `ForcedMoveMiddleware`
  proposes it and no model is called.

## System 1 failures

- **Retry envelope.** `GatewayRanker._ask` and `_aask` retry only transient errors (rate limit,
  connection, timeout, internal server error): `max_attempts=3` in total, with
  `backoff_seconds` of 0.5 s and then 1 s between attempts. Other errors and malformed answers
  fail at once. The server's classifiers use the shared pool's HTTP clients, which have a 15 s
  timeout. A request whose three attempts all time out therefore blocks for about 46.5 s before
  `RankingFailed`. That figure is arithmetic from the constants, not a measurement. A tournament
  makes two sequential requests (heats, then final), so it can take twice as long in the worst
  case.
- **Hybrid degrades, System-1-only fails.** On `RankingFailed`, `_after_ranking` freezes a
  `skipped` decision when `has_model` is true and the LLM plays without candidates. With
  `has_model=False` (`policy="systemone"`) the error is re-raised, so the run fails and the turn
  stays pending.
- **Skipped time is recorded.** `RankingFailed` carries `elapsed_ms` and the calls that completed
  before the failure. The `skipped` decision stores both, so
  `Ply.meta["SystemOneMiddleware"].latency_ms` shows the time lost to a failed ranking, and that
  time is also folded into the turn's latency.
- **Frozen per turn.** The decision is keyed to the turn id and replayed on every retry. A resume
  never re-ranks, so a retry cannot flip the gate and does not count ranking time or calls twice.

## Client pool lifetime

- The System 1 classifiers share one `ClientPool` per process (`POOL`, 15 s timeout). It lives in
  `clients.py` rather than `graph.py` because langgraph loads `graph.py` under a generated module
  name, and a pool kept there would exist once per copy.
- `get()` creates the sync and async `httpx2` client pair on first use. A lock makes sure that
  concurrent first uses create only one pair.
- The FastAPI app's `lifespan` calls `POOL.aclose()` on shutdown. The Agent Server merges that
  lifespan with its own. `aclose` closes both clients if a pair exists, and the next `get()`
  creates a fresh pair (`apps/server/tests/test_clients.py`).

## What the web UI shows

- **Submits.** Every submit (`apps/web/src/useGame.ts`, `send`) uses `multitaskStrategy:
  "reject"`. It carries the game's recorded settings in `config.configurable` (built by
  `configurableOf` in `apps/web/src/settings.ts`: `version` first, then every setting key), plus
  `WEB_TRACE` (`run_name: "chess-web"`, tag `web`) and metadata `surface: "web"`.
- **Rejected commands.** When `ChessCore` rejects a command, it writes the reason to state
  `error`. The table shows it as a dismissible "Move rejected" banner. Each new command re-arms
  the banner.
- **Failed runs.** A run failure arrives as the stream's error, or as a submit error if it
  failed before reaching the stream. It is shown as an inline error message. A 401 or 403 from
  the Agent Server shows a "LangSmith API key needed" banner instead. The check is anchored so
  that a model provider's 401 inside a failed run does not look like the browser's key. A
  "run already in flight" rejection is dropped silently.
- **Pending turns.** When the last turn is `pending`, the board locks and only a **Retry** button
  is offered. It sends empty input (`retry`), because a fresh `go` would be rejected while a turn
  is pending. The human's move is shown optimistically until the run settles, whether it
  succeeds or fails.
- **Thread loading.** A game whose thread fails to load shows "Couldn't load this game" with a
  Reload button. A thread the server doesn't have shows "This game isn't on the server". A thread
  whose recorded settings can't be read can only be viewed.

## How to read a production trace against the code

- **Slicing web traffic.** Split on `run_name: "chess-web"`, tag `web` or metadata
  `surface: "web"` before comparing latency. Studio and SDK runs lack these markers and may use
  different settings. Graph run metadata also records the values actually sent
  (`reasoning_effort`, and `max_tokens` when `model_kwargs` set it) via `sent()`.
- **LLM span names.** `chat_model` names the model after the model part of its spec
  (`model_identity(model)[1]`), so gateway calls appear under the model name rather than
  `ChatOpenAI`. Output is capped at `MAX_TOKENS = 64000`, reasoning included. The cap is lowered
  to the model's own output limit, or to half of a small context window, when those are smaller,
  and a `max_tokens` in `model_kwargs` replaces it.
- **Stall retries.** Two LLM spans in one root with no feedback message between them, the first
  errored with `StreamChunkTimeoutError`, is `StallRetry`, not an illegal-reply retry.
- **System 1 span names.** Each classifier request is traced as `systemone.rank`,
  `systemone.heats` or `systemone.final`. A tournament is one heats span followed by one final
  span. A transient retry shows up as a repeated span with the same name.
- **Recorded cost versus traced calls.** `CallRecorder` appends a `Call` only when a response
  arrives (`on_llm_end`), and drops errored or stalled provider attempts in `on_llm_error`. The
  turn's `calls` therefore undercount attempts that LangSmith shows as errored spans. A call whose
  request carried hosted tools is marked `cost_complete: False`. System 1 calls are recorded with
  the classifier's reported token usage; their `cost_usd` is `None` whenever genai-prices has no
  price for the model.
- **Two latencies.** `turn.latency_ms`, which is copied onto the ply, is the wall time inside
  `ChessCore.wrap_model_call` (stall waits included) plus each extension's `turn_latency_ms`
  (System 1 ranking, counted once). The extension time is added when the turn finalizes or is
  abandoned. It excludes summarization and graph overhead, so root-trace latency is higher. A
  System-1-played turn records its ranking time, and a forced turn records 0 ms.

## Code-anchored checks for each refresh

| # | Code claim (Correlated) | Source | What to look for in the sample |
|---|---|---|---|
| 1 | One run plays at most one turn. A normal LLM turn makes **one** `llm` call. System-1-played and forced turns make zero. | `core.py` `wrap_model_call`, `_parse`; `forced_move.py` | LLM spans per root. More than one means illegal-reply retries, stall retries or provider-level retries. |
| 2 | Illegal replies get up to `max_retries=3` more attempts before a resignation with reason `illegal_moves`. The budget survives resumes. | `core.py` `_parse`; `agent.py` | Roots with 2–4 LLM spans, and any resignation. Report the rejection signature only (no `MOVE:` line, empty, disallowed move), never the text. |
| 3 | `StallRetry` retries a `StreamChunkTimeoutError` once, in the same turn; a second stall fails the run. | `stall_retry.py` `StallRetry`, `stall_errors` | Errored LLM spans with that type, whether a retry follows, roots near 120 s or 240 s, errored roots after two stalls. |
| 4 | The hybrid gate plays when `threshold < 1` and the signal is at least the threshold (default 0.9, margin). | `settings.py`; `middleware.py` `_freeze` | Share of hybrid turns with no LLM span after a System 1 span. |
| 5 | More than 16 allowed moves (SemIf) triggers a tournament: two sequential requests. | `ranker.py` `default_max_options` | Heats and final spans, and the wall time they add. |
| 6 | Transient System 1 errors: 3 attempts, 15 s client timeout, 0.5 s then 1 s backoff, about 46.5 s worst case per request. | `ranker.py` `_ask`; `clients.py` `POOL` | Repeated `systemone.*` spans, spans near 15 s, outliers dominated by System 1 time. |
| 7 | Ranking failure: hybrid goes `skipped` and records the elapsed time. `policy="systemone"` fails the run. | `middleware.py` `_after_ranking`, `_skipped` | Errored roots in System-1-only games. Failed System 1 spans followed by an LLM span. |
| 8 | Summarization runs only with `memory=True`, which is off by default. | `settings.py`; `agent.py`; `summarization.py` | Any `summary`-kind call. None is expected under defaults. |
| 9 | Output cap is `MAX_TOKENS = 64000`, or less where the model's limits require it. | `chat_models.py` | Calls that stop at the length limit, followed by a retry. |
| 10 | Context overflow becomes `ContextBudgetError`, and the turn stays pending. | `core.py` `looks_like_overflow` | Errored roots with this exception type. |
| 11 | An empty-input resume with a frozen proposal commits without calling the model. | `useGame.ts` `retry`; `core.py` `_retry` | Roots with no LLM span that commit right after an errored root on the same game (describe the pattern only). |
| 12 | Settings failing validation fail the run before a turn opens. | `context.py` `resolve_context`; `settings.py` `resolve` | Errored roots with no child spans and a validation error type. |
| 13 | Off by default: `memory`, `with_eval`, `with_nouls`, `top_p`, `tournament_threshold`, `gate="confidence"`, `systemone_model="typesafe/jev-latest"`, non-empty `model_kwargs`. | `settings.py` | Whether any sampled run enables them. |
| 14 | The UCI adapter plays System 1's `fallback_move`, or a seeded random legal move, after a cancellation or failure. | `libs/cli/langchain_chess_cli/uci/completion.py` `_fallback` | Out of scope for server traces. |

## Runtime findings and opportunities

These are code-derived watch items. None has Observed evidence yet; no failing or outlier traces
could be inspected in this refresh.

1. **A stalled gateway stream is the longest single wait in a turn.** (Correlated, check 3.)
   `StallRetry` waits out a full chunk timeout and then retries once with no delay, all inside
   `ChessCore.wrap_model_call`, so the stall time lands in `turn.latency_ms` while the stalled
   attempt records no `Call`. Before raising `max_retries` or adding error types to
   `stall_errors()`, count stalled spans in outlier and error roots: extra retries multiply the
   wait, and any non-stall error added there would stop failing the turn. Keep
   `on_failure="error"`, because the pending turn's Retry depends on the error surfacing.
2. **A degraded classifier stalls hybrid turns before the LLM starts.** (Correlated, checks 6
   and 7.) With a 15 s timeout, 3 attempts and two requests per tournament, a failing System 1
   can add tens of seconds. The elapsed time appears in `SystemOneMeta.latency_ms` and in the
   turn's latency. Before tuning `timeout_s`, `max_attempts` or the backoff, measure System 1
   span time in outlier roots.
3. **Illegal-reply retries repeat the most expensive call.** (Correlated, check 2.) Before
   changing `SYSTEM_PROMPT`, `feedback_text`, `move_list` or `max_retries`, count LLM spans per
   root and classify the rejection signature. A reply truncated at the length cap needs a
   different fix from a disallowed move, and a stall retry is neither.
4. **Recorded turn cost is a lower bound.** (Correlated.) Errored and stalled provider attempts
   are not recorded, hosted-tool calls are marked incomplete, and System 1 calls may be unpriced.
   Use LangSmith spans to reconcile spend. Read the `CallRecorder` docstring about run-tree keying
   before changing it.
5. **The gate may act as a pruner in practice.** (Hypothesis, check 4.) If sampled hybrid turns
   almost always reach the LLM, System 1 adds latency without saving LLM calls.
6. **Summarization is unlikely to appear in production traces.** (Correlated, check 8.) It is
   opt-in and needs a model with a known input limit. For coverage, rely on `libs/chess/tests`.

## Focused tests

- `libs/chess/tests/test_contract.py`: a stalled stream is retried within the turn; a second
  stall fails the turn and Retry resumes it; only a stall is retried; without `langchain_openai`
  nothing is a stall; completed calls survive a wrapper failure; a resume calls the model again;
  overflow after a completed call is still `ContextBudgetError`.
- `libs/chess/tests/test_lifecycle.py`: overflow surfaces as `ContextBudgetError`.
- `libs/systemone/tests/test_middleware.py`: ranking time counts once across retries; a skipped
  ranking carries its elapsed time.
- `libs/systemone/tests/test_ranker.py`: `RankingFailed.elapsed_ms` is set.
- `apps/server/tests/test_clients.py`: concurrent first use makes one client pair; closing
  resets the pool.

## This pull

- **Observed:** no figures, because the raw sample was not accessible to this refresh. When a
  later refresh can read it, record here the bucket counts (error / outlier / baseline), baseline
  medians, per-kind (`llm`, `summary`, `systemone`) call counts and latency or token totals, and
  the results of the checks above. Bucket counts describe how the anomaly-weighted sample was
  built. They are not fleet rates.
