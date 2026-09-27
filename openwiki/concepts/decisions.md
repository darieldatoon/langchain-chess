---
type: Decision record
title: Decisions and measurements
description: Design choices in langchain-chess that look like gaps (no Anthropic prompt caching, the removed `full` memory mode, memory now a plain on/off switch) with the measured numbers behind them and the conditions under which to revisit them. Also notes which defaults, such as the System 1 threshold, have no recorded measurement.
tags: [decisions, measurements, prompt-caching, memory, anthropic, cost, system-one]
verified:
  - by: openwiki/0.6.0
    at: 2026-09-27T19:08:28.877Z
sources:
  - id: openwiki-source-0486059a508cedacd209f083
    resource: repo://apps/server/tests/test_context.py
  - id: openwiki-source-08efc3f1935724156208ec17
    resource: repo://apps/server/tests/test_graph.py
  - id: openwiki-source-fc393bc7c06df7c3f85ece92
    resource: repo://libs/chess/langchain_chess/middleware/core.py
  - id: openwiki-source-4a4d83b98e02f02b6b258e76
    resource: repo://libs/chess/langchain_chess/middleware/summarization.py
  - id: openwiki-source-6c9b823f6aaa5fb3802d7fae
    resource: repo://libs/chess/langchain_chess/pricing.py
  - id: openwiki-source-e92c3d9adb77a4ffddf28116
    resource: repo://libs/chess/langchain_chess/prompt.py
  - id: openwiki-source-cbaaf1981eee0f537632c225
    resource: repo://libs/chess/langchain_chess/settings.py
  - id: openwiki-source-89cf26730d6633d36dd4f627
    resource: repo://libs/chess/langchain_chess/state.py
  - id: openwiki-source-c228b1f5ddeb31cb2374ed59
    resource: repo://libs/systemone/langchain_chess_systemone/agent.py
  - id: openwiki-source-3c3f476720af9ceef23b678d
    resource: repo://libs/systemone/langchain_chess_systemone/middleware.py
  - id: openwiki-source-21de6a067affac443ab60933
    resource: repo://libs/systemone/langchain_chess_systemone/settings.py
generated: { by: "openwiki/0.6.0", at: "2026-09-27T19:08:28.877Z" }
---

# Decisions and measurements

This page records the choices that can look like missing features, the numbers behind them,
and when to reopen them. It replaces `docs/decisions.md`, which no longer exists; the README now
points to the OpenWiki for these decisions. The source of record is the "Decisions and
measurements" section of the repository's OpenWiki brief, `openwiki/INSTRUCTIONS.md`. When the
numbers change, update them in the brief first and then here. Other wiki pages should link to
this page and not repeat the numbers.

> **Naming note.** The brief still uses the older mode names `memory="none"` and
> `memory="summarize"`. In current code `memory` is a boolean setting: `memory=False` (the
> default) is the old `none`, and `memory=True` is the old `summarize`. The measurements below are
> quoted with the brief's names so they match the source of record.

| Decision | Status | Revisit when |
| --- | --- | --- |
| Anthropic prompt caching | Shipped without | Long memory-on (`summarize`) games become the norm |
| `full` memory mode | Removed. `memory` is now a bool: off (old `none`) or on (old `summarize`) | The imitation risk from System 1's bare turns gets measured |
| System 1 `threshold` default (0.9) and `tournament_threshold` | No measurement recorded | Before tuning either |

## Prompt caching (Anthropic): shipped without

### Why a cache breakpoint would never hit

With the `langsmith:` provider (the LLM Gateway, `GATEWAY_PREFIX` in
`libs/chess/langchain_chess/models.py`), requests go through the gateway's **Responses route**.
That route accepts only one request-level cache breakpoint, and it lands on the last part of the
request, which is the per-turn position message. That message changes every turn, so the cache
never hits.

The prompt layout explains this. `render_position` in `libs/chess/langchain_chess/prompt.py`
builds "the trailing human message appended to every move request", which is never stored. It
always contains the moves so far, the starting FEN for a non-standard start, the side to move,
check, any restricted-move list and the request for `MOVE: <move>`. The bundled renderer
(`position_renderer`) adds, depending on the `show_fen`, `show_board` and `move_list` settings,
the FEN, an ASCII board, any suggested candidates and the legal moves. Everything before it is
the system prompt plus whatever `model_view` keeps from earlier turns.

To make caching work you would need both of these:

- `ChatAnthropic` on the gateway's native `/anthropic` route, not the Responses route, and
- a cache breakpoint placed **before** the position message, so that the stable prefix (the
  system prompt and any earlier turns) is what gets cached.

### Why it isn't worth doing yet

| Measurement (from the brief) | Value |
| --- | --- |
| Input tokens per move, `memory="none"` (the default; now `memory=False`) | about 520, mostly the per-turn position |
| Opus 5 minimum cacheable prefix | 512 tokens. The cacheable prefix under `none` is smaller than this |
| Input tokens per move, removed `full` mode, 12-ply games | about 1,000 on average, at most 1,850 |
| Input price used for the estimate | $5 per million input tokens |
| Estimated saving from caching | under half a cent a move |

With memory off the model sees only the current turn. `model_view` starts its window at the
current turn's `opened_message_id`, so the prefix doesn't grow as the game goes on. With memory
on (`summarize`) it keeps the whole history, minus earlier turns' rejected attempts and their
feedback, and that history grows until it is summarized at 70% of the model's input limit
(`DEFAULT_TRIGGER = ("fraction", 0.7)` in `middleware/summarization.py`). Long memory-on games
are therefore the case where a cacheable prefix could become large enough to matter.
**Revisit if long `summarize` games become the norm.**

OpenAI models cache automatically, so none of this applies to them.

Cost accounting already handles cache tokens even though the repo sets no breakpoints.
`libs/chess/langchain_chess/pricing.py` normalises `cache_read` and `cache_creation` usage
details, and the TTL-split `ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens` that
`ChatAnthropic` reports. Each `Call` in state stores `cache_read_tokens`, `cache_write_tokens` and
`cache_write_1h_tokens`. If caching is added later, it will be priced without changes to the
recorder. See [Model specs, LLM Gateway and cost](models-gateway-and-cost.md).

## Memory and analysis length: `full` removed

### What was measured

The test compared `memory="none"` with the since-removed `full` mode. `full` showed every earlier
turn verbatim, with no compaction. The sample was three self-play `hybrid` games per mode, each 12
plies at low reasoning effort, run on 2026-09-25.

| Mode | Mean LLM analysis length |
| --- | --- |
| `memory="none"` | 97 characters |
| `full` (removed) | 213 characters |

The concern being tested was that bare `MOVE:` turns in the history would make the LLM terser.
When System 1 or another non-LLM source plays, `ChessCore` stores only a bare
`AIMessage("MOVE: <san>")` for that ply (`libs/chess/langchain_chess/middleware/core.py`). A
model that sees these messages might copy them and drop its analysis. In this sample, seeing
earlier bare `MOVE:` turns did **not** make the LLM terser. Its analysis was longer with `full`.

### What was not measured

**System 1 played no moves in the `full` games of that sample.** The bare turns the LLM saw came
from its own earlier replies, not from System 1. The risk that the LLM imitates System 1's bare
turns is therefore still unmeasured. Measure that risk before bringing back a verbatim-history
mode, or before claiming that memory-on (`summarize`) is free of the risk.

### Current state in code

- `memory` is a `bool` setting on `CoreSettings` in `libs/chess/langchain_chess/settings.py`,
  default `False`, described as "Keep earlier turns, summarized at 70% of the model's input
  limit". The server's `ChessContext` (defined in
  `libs/systemone/langchain_chess_systemone/settings.py` and resolved by
  `apps/server/langchain_chess_server/context.py`), the CLI's `--memory/--no-memory` option and
  the UCI `Memory` check option all use this boolean. Settings-file versions 1 and 2 both record
  `"memory": false` as the default.
- The old string values no longer validate: `memory="full"` fails with a validation error
  (`test_full_memory_is_gone` in `apps/server/tests/test_graph.py`), and so does
  `memory="summarize"` (`test_bad_values_fail_validation` in `apps/server/tests/test_context.py`).
- Memory needs a model with a known input limit. `build_agent` in
  `libs/systemone/langchain_chess_systemone/agent.py`, shared by the server and the CLI, raises
  `ChessContractError` ("… has no known input limit, so it can't use memory; turn it off") when
  it doesn't. Memory is ignored when no LLM plays: under the `systemone` policy no model is built,
  so memory is forced off. See [Prompt and memory](prompt-and-memory.md).

## Defaults with no recorded measurement

The System 1 gate defaults have **no measurement recorded** behind them in the brief or anywhere
else in the repo:

- `threshold = 0.9`. System 1 plays when the gate signal (`margin` by default, or `confidence`)
  is at least this value. `0` always plays and `1` never does. The default is set in
  `SystemOneMiddleware.__init__` and in `SystemOneSettings`, which `ChessContext` inherits.
- `tournament_threshold = None`. When a SemIf tournament ranked more options than one System 1
  request holds, this value applies instead of `threshold`. If it is left empty, `threshold` is
  used.

Treat both as unvalidated starting points. If you tune them, record the sample and the numbers in
the brief's "Decisions and measurements" section and on this page. See
[System 1](../architecture/system-one.md) for how the gate works.

## Related pages

- [Model specs, LLM Gateway and cost](models-gateway-and-cost.md)
- [Prompt and memory](prompt-and-memory.md)
- [Runtime behavior](../operations/runtime-behavior.md)
- [System 1](../architecture/system-one.md)
- [Quickstart](../quickstart.md)
