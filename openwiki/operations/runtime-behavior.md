---
type: operations runtime evidence
title: Runtime behavior (LangSmith evidence)
description: Runtime complement to the static docs for the chess graph deployed as langchain-chess-app. It lists code-anchored checks (one model call per turn, illegal-reply retries, System 1 gate and tournament, ranking retries and the skipped path, summarization, MAX_TOKENS, UCI fallbacks), explains how to read LangSmith traces against the code, and holds a dated section for each pull plus a ranked list of runtime findings.
tags: [runtime, langsmith, traces, latency, cost, operations, systemone, turn-lifecycle]
verified:
  - by: openwiki/0.6.0
    at: 2026-09-26T04:03:54.007Z
sources:
  - id: openwiki-source-65aad166aa88a58cc7a8319a
    resource: repo://apps/server/langchain_chess_server/context.py
  - id: openwiki-source-c9b903d37e22daedc4499a4b
    resource: repo://apps/server/langchain_chess_server/graph.py
  - id: openwiki-source-611421396243f4b643f6d94a
    resource: repo://apps/web/src/useGame.ts
  - id: openwiki-source-3ae14faf8cc85a90b40ed182
    resource: repo://libs/chess/langchain_chess/agent.py
  - id: openwiki-source-fc393bc7c06df7c3f85ece92
    resource: repo://libs/chess/langchain_chess/middleware/core.py
  - id: openwiki-source-cf036aa5f44c795ee62f143f
    resource: repo://libs/chess/langchain_chess/recorder.py
  - id: openwiki-source-20ebabb38d27c2e3522a9062
    resource: repo://libs/cli/langchain_chess_cli/uci/completion.py
  - id: openwiki-source-3c3f476720af9ceef23b678d
    resource: repo://libs/systemone/langchain_chess_systemone/middleware.py
  - id: openwiki-source-79af0d552c660a058f4241b8
    resource: repo://libs/systemone/langchain_chess_systemone/ranker.py
generated: { by: "openwiki/0.6.0", at: "2026-09-26T04:03:54.007Z" }
---

# Runtime behavior (LangSmith evidence)

This page collects production runtime findings for the `chess` graph in the LangSmith project
`langchain-chess-app`. It exists to help a coding agent answer four questions: where time and
tokens go, which code paths actually run, what the real operating envelope is, and what to watch
before changing an area. Static behavior is covered elsewhere:

- [turn lifecycle](../architecture/turn-lifecycle.md): turn count, retries, latency accounting
- [System 1](../architecture/system-one.md): per-call usage, gate, tournament
- [models, gateway and cost](../concepts/models-gateway-and-cost.md)
- [prompt and memory](../concepts/prompt-and-memory.md)
- [Agent Server adapter](../integrations/agent-server.md)

Measured design decisions, such as the default models and description style, are recorded in the
README's [Decisions and measurements](../../README.md#decisions-and-measurements) section. This
page does not repeat them.

Every statement below carries one of three labels:

- **Observed:** comes straight from sampled traces.
- **Correlated:** tied to source code this page cites.
- **Hypothesis:** a change or check that still needs verifying.

The trace sample is **anomaly-weighted**. Traces are bucketed as `error`, `outlier` (the slowest
runs that did not error) and `baseline`. Bucket counts describe how the sample was built. They
are not fleet rates. Only baseline medians describe normal operation.

## Status of evidence

- **Observed (this pull):** none. The LangSmith raw items for the `langsmith` connector could not
  be read from this page's generation context. The page therefore reports **no** trace counts,
  latencies, token totals, error signatures or trace URLs. Other pages that link here
  ([turn lifecycle](../architecture/turn-lifecycle.md#runtime-evidence),
  [System 1](../architecture/system-one.md#runtime-evidence),
  [models, gateway and cost](../concepts/models-gateway-and-cost.md)) also report no figures.
  Nothing on this page should be read as a production measurement until a refresh fills in the
  "This pull" section.
- The rest of the page is durable. It gives the code-anchored checks each refresh should run, and
  explains how to read a trace against the code so those checks can be evaluated quickly.

## How to read a production trace against the code

These points come from reading the code (**Correlated**). They tell you what a trace *should*
show, so a divergence is easy to spot.

- **Slicing web traffic.** Every web UI submit sets `run_name: "chess-web"`, tag `web` and
  metadata `surface: "web"`. Every submit also carries the full knob set in
  `config.configurable` (`apps/web/src/useGame.ts`, `WEB_TRACE` and `send`). Studio and SDK runs
  lack these markers. Split on them before comparing latency, because the two surfaces can run
  with different knobs.
- **LLM span names.** `chat_model` passes `name=<model name>`, so gateway calls appear under the
  model name instead of the generic `ChatOpenAI` (`apps/server/langchain_chess_server/graph.py`,
  `chat_model`).
- **System 1 span names.** Each classifier request is traced as `systemone.rank`,
  `systemone.heats` or `systemone.final` (`libs/systemone/langchain_chess_systemone/ranker.py`,
  `RANK_RUN`/`HEATS_RUN`/`FINAL_RUN`). A SemIf tournament is exactly one heats span followed by
  one final span. A transient retry shows up as a repeated span with the same name inside one
  turn.
- **Recorded cost versus traced calls.** `CallRecorder` appends a `Call` only when a response
  arrives (`on_llm_end`). A provider call that errors is dropped in `on_llm_error`
  (`libs/chess/langchain_chess/recorder.py`). The turn's `calls` therefore undercount failed
  attempts that LangSmith still shows as errored spans. SemIf calls have no token usage, so their
  cost is `None` by design (see [models, gateway and cost](../concepts/models-gateway-and-cost.md)).
- **Two latencies that differ.** `turn.latency_ms` (copied onto the ply) adds up only the time
  spent inside `ChessCore.wrap_model_call` (`libs/chess/langchain_chess/middleware/core.py`,
  `_finish`). It excludes System 1 ranking, summarization and graph overhead. Root-trace latency
  is therefore higher, and a System-1-played or forced turn records 0 ms of model latency.
- **Skipped System 1 records no latency.** A `skipped` decision stores `latency_ms=0.0` whatever
  time the failed attempts took (`libs/systemone/langchain_chess_systemone/middleware.py`,
  `_skipped`). To see what a failed ranking cost in time, use the trace spans, not
  `Ply.meta["SystemOneMiddleware"].latency_ms`.

## Code-anchored checks for each refresh

Each check names the claim the code makes and what would count as a finding. When the check is
only a boring confirmation, drop it from "This pull".

| # | Code claim (Correlated) | Source | What to look for in the sample |
|---|---|---|---|
| 1 | One run plays at most one turn. A normal LLM turn makes **one** `llm` call. System-1-played and forced turns make **zero**. | `libs/chess/langchain_chess/middleware/core.py` (`wrap_model_call`, `_parse`); `libs/chess/langchain_chess/agent.py` (`forced_move`) | LLM spans per root. More than one means illegal-reply retries or provider-level retries. |
| 2 | Illegal replies are retried up to `max_retries=3`, so a turn makes at most 4 LLM calls before it resigns with reason `illegal_moves`. | `core.py` `_parse`; `agent.py` `create_chess_agent(max_retries=3)` | Roots with 2–4 LLM spans. Any resignation. Whether the rejected replies lacked a `MOVE:` line, were empty, or named a disallowed move (report the signature only, never the text). |
| 3 | The hybrid gate plays when `threshold < 1` and the signal is at least `threshold` (default `0.9`, margin gate). | `apps/server/langchain_chess_server/context.py` (`threshold`, `gate`); `middleware.py` `_freeze` | Share of hybrid turns with no LLM span after a System 1 span. If it is near zero, the gate is acting as a pure pruner. |
| 4 | More than 16 allowed moves triggers a SemIf tournament: two sequential requests. | `ranker.py` (`default_max_options`, `HEATS_RUN`/`FINAL_RUN`) | Whether heats and final spans appear, and how much wall time they add compared with `systemone.rank`. |
| 5 | Transient errors are retried: 3 attempts total, a 15 s client timeout, backoff 0.5 s then 1 s. If every attempt times out, one request can block for about 46.5 s before `RankingFailed` (arithmetic from the constants, not a measurement). | `ranker.py` `GatewayRanker.__init__`, `_ask`; `graph.py` `_classifier(timeout=15.0)` | Repeated `systemone.*` spans. System 1 spans near 15 s. Outlier roots dominated by System 1 time. |
| 6 | When ranking fails, hybrid turns go `skipped` and the LLM plays unaided. `policy="systemone"` (`has_model=False`) fails the run and leaves the turn pending. | `middleware.py` `_after_ranking`; `graph.py` `systemone` | Errored roots in System-1-only games. Hybrid turns with a failed System 1 span followed by an LLM span. |
| 7 | Summarization runs only with `memory="summarize"`. The server default is `memory="none"`. Gateway models without a profile need `summary_trigger_tokens`. | `context.py` `memory`, `summary_trigger_tokens`; `graph.py` `PROFILES`, `summarization`; `libs/chess/langchain_chess/middleware/summarization.py` | Any `summary`-kind LLM call. Absence is expected under defaults. A summary call on a turn that also retried. |
| 8 | Output is capped at `MAX_TOKENS = 32000`, reasoning included. | `graph.py` `MAX_TOKENS`, `chat_model` | Output tokens per LLM call in outliers. Any call that stopped at the length limit, which would show up as an empty or `MOVE:`-less reply followed by a retry. |
| 9 | Context overflow is re-raised as `ContextBudgetError`, and the turn stays pending. | `core.py` `wrap_model_call` (`looks_like_overflow`) | Errored roots with this exception type. Expected to be rare under `memory="none"`. |
| 10 | The web client's `retry` sends empty input to resume a pending turn. A retry with a frozen proposal replays it without calling the model again. | `apps/web/src/useGame.ts` `retry`; `core.py` retry path | Roots with no LLM span that nonetheless commit a move right after an errored root on the same game (describe the pattern only, never thread ids). |
| 11 | Knobs that are installed but off by default: `with_eval`, `with_nouls`, `top_p`, `tournament_threshold`, `gate="confidence"`, `systemone_model="typesafe/jev-latest"`. | `context.py` | Whether any sampled run turns them on. A dead knob is worth one line. |
| 12 | The UCI adapter plays System 1's `fallback_move`, or else a seeded random legal move, after a cancellation or failure. | `libs/cli/langchain_chess_cli/uci/completion.py` `_fallback` | Out of scope for server traces. The UCI engine runs in-process, not on `langchain-chess-app`. Note it only if CLI traces appear in the project. |

## Runtime findings & opportunities

Ranked by how much they should change an agent's approach. Until a sample is read, every item is
a code-derived watch item, marked **Correlated** or **Hypothesis**, with no Observed evidence.

1. **System 1 failures can hide a long stall behind a `skipped` status.** (Correlated, check 5
   and 6.) With a 15 s timeout and 3 attempts per request, and two requests for any tournament,
   a degraded classifier can add tens of seconds before the LLM even starts. `_skipped` records
   `latency_ms=0.0`, so ply telemetry will not show the stall.
   *Implication:* before tuning `timeout_s`, `max_attempts` or `backoff_seconds` in
   `ranker.py`, measure System 1 span time in outlier roots. Do not trust
   `SystemOneMeta.latency_ms` for failed rankings.
   **Hypothesis:** record the elapsed time in `_skipped` so telemetry and traces agree.
2. **Illegal-reply retries multiply the most expensive call.** (Correlated, check 2.) Each
   rejected reply repeats the full LLM call, reasoning included, under a 32 000-token output cap.
   *Implication:* before changing `SYSTEM_PROMPT`, `feedback_text`, `show_legal_moves` or
   `max_retries`, count LLM spans per root in the outlier bucket and classify the rejection
   signature. A reply cut off by the length limit (check 8) is a different fix from a
   disallowed move.
3. **Recorded turn cost is a lower bound.** (Correlated.) Errored provider attempts are not
   recorded, and SemIf calls are unpriced. *Implication:* use LangSmith spans, not
   `turns[].calls`, when you reconcile spend. Do not "fix" the gap in `CallRecorder` without
   reading the module docstring about run-tree keying.
4. **The gate may be a pruner in practice.** (Hypothesis, check 3.) The 0.9 margin threshold is
   strict. If sampled hybrid turns almost always reach the LLM, System 1 adds latency without
   saving LLM calls. *Implication:* check the played/shortlist split before you change
   `threshold` or `tournament_threshold` defaults, and compare with the README measurements.
5. **Summarization is probably dead under defaults.** (Correlated, check 7.) The server default is
   `memory="none"`, so `ChessSummarization` is only exercised when someone opts in.
   *Implication:* changes to the summarization path are unlikely to show up in production traces.
   Rely on `libs/chess/tests` and the opt-in live tests for coverage.

Failing traces: none can be reported for this pull, because the sample was not readable (see
"Status of evidence").

## This pull

*Scope: the LangSmith pull for the `langsmith` connector used for this wiki revision
(frontmatter-verified date).*

- **Observed:** no figures. The raw sample was not accessible when this page was generated, so no
  bucket composition, baseline medians, per-call-kind latency or token totals, LLM calls per
  turn, System 1 gate split, tournament frequency or error signatures are recorded.
- **Cost/latency note (observed over the sampled traces):** none available for this pull.

When a later refresh can read the sample, fill in this section with that pull's numbers:
the bucket counts, baseline medians, the per-kind (`llm`, `summary`, `systemone`) call counts and
latency or token totals, and the results of the checks above. Keep the durable sections unchanged
unless the evidence contradicts them.
