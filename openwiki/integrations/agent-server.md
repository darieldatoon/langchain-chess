---
type: integration adapter
title: Agent Server graph and the /ui mount
description: How the LangGraph Agent Server builds the `chess` graph (make_graph, shape, build_agent, the llm/systemone/hybrid policies on a fixed topology), how ChessContext knobs are resolved from assistant context and run `configurable`, how GameSetupMiddleware records a game's settings in thread state, the shared System 1 HTTP client pool, what ServerSettings validates, and how a custom FastAPI app serves the web UI, its config, and model input limits under /ui.
tags: [agent-server, langgraph, graph-factory, context, configuration, fastapi, web-ui]
verified:
  - by: openwiki/0.6.0
    at: 2026-09-26T13:04:36.303Z
sources:
  - id: openwiki-source-b9886f4aee6bc16bdaea61ff
    resource: repo://apps/server/langchain_chess_server/app.py
  - id: openwiki-source-72cff634549a72fbc164bc15
    resource: repo://apps/server/langchain_chess_server/clients.py
  - id: openwiki-source-65aad166aa88a58cc7a8319a
    resource: repo://apps/server/langchain_chess_server/context.py
  - id: openwiki-source-88d085345a1ecd09c61f7ab0
    resource: repo://apps/server/langchain_chess_server/game_setup.py
  - id: openwiki-source-c9b903d37e22daedc4499a4b
    resource: repo://apps/server/langchain_chess_server/graph.py
  - id: openwiki-source-e3b0d2af80ee0702b2be4a6b
    resource: repo://apps/server/langchain_chess_server/settings.py
  - id: openwiki-source-0c7af728d91c2bdeaf4f3679
    resource: repo://apps/server/tests/test_app.py
  - id: openwiki-source-85a241004b3536de61fe173c
    resource: repo://apps/server/tests/test_clients.py
  - id: openwiki-source-0486059a508cedacd209f083
    resource: repo://apps/server/tests/test_context.py
  - id: openwiki-source-08efc3f1935724156208ec17
    resource: repo://apps/server/tests/test_graph.py
  - id: openwiki-source-81f430313af7099d0ab0f750
    resource: repo://apps/server/tests/test_live.py
  - id: openwiki-source-434b43fa9c75a1218beca2f5
    resource: repo://apps/web/src/modelLimit.ts
  - id: openwiki-source-3cb426dd15d324cb1ef8679d
    resource: repo://apps/web/src/settings.ts
  - id: openwiki-source-be4a82601d4a0ee9e1634703
    resource: repo://apps/web/src/setup.ts
  - id: openwiki-source-5bbba7b2a8ea8360ff233d63
    resource: repo://langgraph.json
  - id: openwiki-source-3ae14faf8cc85a90b40ed182
    resource: repo://libs/chess/langchain_chess/agent.py
  - id: openwiki-source-65bee4ff16ecbe51243c1e47
    resource: repo://libs/chess/langchain_chess/chat_models.py
  - id: openwiki-source-3c3f476720af9ceef23b678d
    resource: repo://libs/systemone/langchain_chess_systemone/middleware.py
  - id: openwiki-source-79af0d552c660a058f4241b8
    resource: repo://libs/systemone/langchain_chess_systemone/ranker.py
  - id: openwiki-source-fd0e9360c0eb5b2cec5ea440
    resource: repo://packages/chess-ui/src/types.ts
generated: { by: "openwiki/0.6.0", at: "2026-09-26T13:04:36.303Z" }
---

# Agent Server graph and the /ui mount

`apps/server` (package `langchain_chess_server`) is the Agent Server adapter. It adds no chess logic. It turns runtime knobs into a call to `create_chess_agent` from `libs/chess`, with either `SystemOneMiddleware` or its placeholder `NoSystemOne` from `libs/systemone`, adds one server-owned middleware (`GameSetupMiddleware`), and serves the built web UI next to the graph API. Nothing else depends on it.

`langgraph.json` wires both entrypoints:

| Key | Target | Role |
| --- | --- | --- |
| `graphs.chess` | `apps/server/langchain_chess_server/graph.py:make_graph` | Graph factory. The Agent Server calls it with the config and runtime. |
| `http.app` | `apps/server/langchain_chess_server/app.py:app` | Custom FastAPI routes merged into the server: `/ui`, `/ui/`, `/ui/config`, `/ui/model-limit`, plus a lifespan hook. |
| `env` | `.env` | Environment file for the server. Name the variables only. Never document their values. |

For the image build (uv workspace, `dockerfile_lines`), see [deployment](/openwiki/operations/deployment.md).

## From a factory call to a compiled graph

```mermaid
flowchart TD
    Call["Factory call: config plus runtime"] --> MG["make_graph"]
    MG --> Q{"execution_runtime present?"}
    Q -->|"no: read, update, introspection"| SH["shape: every node switched off"]
    Q -->|"yes: a run"| RC["resolve_context"]
    AC["assistant context"] --> RC
    CF["config configurable"] --> RC
    RC --> CTX["ChessContext, validated"]
    MG --> SS["ServerSettings from env"]
    CTX --> BA["build_agent"]
    SS --> BA
    BA --> P{"policy"}
    P -->|llm| L["chat model plus NoSystemOne"]
    P -->|systemone| S["no model plus SystemOneMiddleware"]
    P -->|hybrid| H["chat model plus SystemOneMiddleware"]
    L --> CCA["create_chess_agent named chess, fixed topology, GameSetupMiddleware"]
    S --> CCA
    H --> CCA
    SH --> CCA
```
*How `make_graph` turns one factory call into a compiled `chess` agent; every branch has the same nodes.*

The Agent Server calls the factory not only to run a thread but also, without the run's settings, to read or update thread state and to describe the graph. So `make_graph(config, runtime)` branches on `runtime.execution_runtime`:

- **No execution runtime** (a read, update or introspection): it returns `shape()`, the graph with every node switched off. `shape()` passes no model, `NoSystemOne()` and a `GameSetupMiddleware(ChessContext())` whose context is never written, so it needs no model, no clients and no credentials. `test_reads_need_no_credentials` deletes the gateway and TypeSafe variables and still builds it.
- **A run**: `build_agent(resolve_context(ChessContext, config, runtime), ServerSettings())`. The factory must accept `runtime`. Assistant settings (the `context` given to `client.assistants.create`, or set in Studio) reach the graph only through `runtime.execution_runtime.context`. If you drop the parameter, those settings are lost with no error. The live test `test_assistant_settings_reach_the_factory_through_runtime` covers this: it runs with no run config, so only the assistant context can select `policy="systemone"`.

Construction is cheap and never calls a model or the System 1 classifier. `test_every_setting_builds_the_graph_reads_rebuild` checks that building every policy and memory combination sends no request to the (fake) System 1 client.

### Fixed topology: a setting may switch a node off but never remove it

Because reads get `shape()` while runs get a fully configured graph, every build must have the same nodes, edges and state schema. The module docstring states the rule, and three mechanisms keep it:

- For `policy="llm"`, `build_agent` inserts `NoSystemOne` instead of dropping System 1. It reports the name `SystemOneMiddleware`, keeps System 1's state schema, and its `before_model` hook returns nothing.
- `create_chess_agent(..., fixed_topology=True)` keeps a no-op summarization node (`NoSummarization`) under `memory="none"`, so the node set doesn't depend on `memory`.
- `GameSetupMiddleware` is present in every build, including `shape()`.

`test_every_setting_builds_the_graph_reads_rebuild` builds each (policy, memory) pair as a run and as a read and asserts identical topology, with `SummarizationMiddleware.before_model`, `SystemOneMiddleware.before_model` and `GameSetupMiddleware.before_agent` always present.

### `build_agent` and the three policies

`build_agent(context, settings, *, checkpointer=None)` takes these steps:

- **Model.** `policy == "systemone"` passes `model=None`. Every other policy builds a chat model with `chat_model(context)`.
- **Middleware.** Always two entries: first `NoSystemOne()` for `llm` or one `SystemOneMiddleware` for `systemone` and `hybrid` (see [System 1](/openwiki/architecture/system-one.md)), then `GameSetupMiddleware(context)`. `test_the_llm_policy_never_asks_system_one` checks that an `llm` ply is sourced from the model and sends no System 1 request.
- **Memory.** When there is no model, memory is forced to `"none"`, so `memory` is ignored for `systemone`.
- **Summarize guard.** With a model and `memory="summarize"`, the model must have a known input limit (`input_limit(model)`, which reads `max_input_tokens` from the model's profile). Otherwise `build_agent` raises a `ChessContractError` saying the model has no known input limit and to use `memory='none'`.
- **Everything else** passes straight through to `create_chess_agent`: `show_legal_moves`, `draw_claims`, `seed`, `fixed_topology=True`, `context_schema=ChessContext`, the optional checkpointer, and `name="chess"`.

`systemone(context, settings)` builds the middleware.

- The ranker is a `GatewayRanker` with the context's `style`, `with_eval` and `with_nouls`. Its client is a `TypeSafeClassifier` built by `_classifier(model, api_key, base_url)` for each build, but its sync and async HTTP clients come from the process-wide connection pool (see below), so every classifier shares one pair of connections.
- `gate`, `k` and `top_p` pass through unchanged.
- **System 1 alone must always play.** For `policy="systemone"`, both `threshold` and `tournament_threshold` are forced to `0.0` and `has_model=False`, whatever the context says. `test_systemone_alone_always_plays_even_with_a_tournament_threshold` checks this. It passes thresholds of 0.95 and 0.99, and the resulting ply reports `threshold_used == 0.0` with `source == "systemone"`. For `hybrid`, the context thresholds apply.

### `chat_model`

The server's `chat_model(context)` is a thin wrapper: it calls `langchain_chess.chat_models.chat_model(context.model, context.reasoning_effort)`. That shared factory calls `init_chat_model` with:

- `max_tokens` set to an output budget: `MAX_TOKENS = 64000` (the cap also covers reasoning tokens; a comment records that 8000 ran out mid-game at medium effort), capped by the model's own output limit when known and by half of a smaller context window. `test_a_small_window_splits_between_input_and_output` checks that `langsmith:openai/gpt-4` (8192-token window) gets `max_tokens = 4096`.
- `name` set to the bare model name from `model_identity`. Without it, every vendor reached through the gateway would show up in traces as `ChatOpenAI`.
- `reasoning_effort`, **only when the context sets one**. Models without reasoning reject the parameter outright, so a `None` effort sends nothing and the model uses its own default (`test_no_reasoning_effort_sends_none` checks that Claude Haiku 4.5's request payload has no `reasoning` key).
- A `profile` whose `max_input_tokens` leaves room for the output budget. Gateway specs (the `langsmith:` prefix) give a `ChatOpenAI` with no profile, and the fractional summarization trigger needs one. On the gateway path the factory looks up the model's context window with `context_window` from `langchain_chess.pricing` (the genai-prices snapshot used for pricing) and, when it is known, sets `profile={"max_input_tokens": window - budget}`; it also consults the vendor integration's profile (if installed) for an output limit. A gateway model the snapshot does not know gets no profile. Native providers keep their own profile, with `max_input_tokens` lowered to `window - budget` when that is smaller.

`test_the_gateway_chat_model` checks the default model (`max_tokens == 64000`, profile `1_048_000 - 64000`, name `zai-org/GLM-5.3-Flash`), and the tests also check that `provider:model` specs and bare names are routed according to the environment.

### Summarization and `model_limit`

The server builds no summarization middleware of its own. `libs/chess` applies its default fractional trigger (70% of the model's input limit), so `memory="summarize"` works only for a model with a known input limit, enforced by the guard in `build_agent` above. `test_summarize_with_a_known_input_limit` builds gateway and native models with limits, and `test_summarize_needs_a_known_input_limit` checks that an unknown gateway model fails with `summarize`, builds with `none`, and that `systemone` with `summarize` still builds. `memory="full"` has been removed and now fails validation.

`model_limit(model)` (cached with `lru_cache(maxsize=64)`) builds `chat_model(ChessContext(model=model))` and returns its `input_limit`, or `None` if the model has no limit or can't be built (`ValueError`/`ImportError`). Because it goes through the same factory, it agrees with what `build_agent` will accept (`test_the_model_limit_agrees_with_the_agent`). The web UI's new-game dialog uses it (through `/ui/model-limit`) to decide whether to offer `summarize`.

## `GameSetupMiddleware`: the game's settings in thread state

`GameSetupMiddleware` adds a `setup` key to the state (`SetupState` extends `ChessState`; the key is marked `OmitFromInput` but not private, because clients read it). It holds `asdict(context)` of the run's resolved `ChessContext` and writes it **once, on the game's first turn**:

- It writes only when `setup` is absent, there is exactly one turn, and that turn is the one this run opened (`invocation.opened_turn`). A later run plays with its own settings, but `setup` keeps naming the first turn's. `test_the_first_turn_records_the_setup_and_later_runs_keep_it` covers this.
- It hooks both `before_agent` (so a first turn whose model call fails still has it; `test_a_first_turn_that_fails_still_records_the_setup`) and `after_agent` (because a first turn that ends the game jumps from `ChessCore.before_agent` straight past this middleware's `before_agent`; the fool's-mate tests cover sync and async).
- A thread from before `setup` existed never gains one, whether the next run is a later turn, an empty retry, the same position, an illegal position, or a retried pending first turn. A rejected first input records no setup.

The web client uses this to continue a game from its thread alone: `gameOf` in `apps/web/src/setup.ts` takes `recordedContext(values.setup)`, which accepts the setup only if every knob is present and valid, since a context filled in from defaults would play a different game. See [state record](/openwiki/concepts/state-record.md) for the rest of the state.

## The System 1 client pool

`clients.py` holds `POOL = ClientPool(timeout=15.0)`, one pair of `httpx2.Client` and `httpx2.AsyncClient` per process:

- `get()` creates the pair on first use under a lock, so concurrent first uses make one pair (`test_concurrent_first_use_makes_one_pair`).
- `aclose()` closes the pair if one exists; the next `get()` makes a fresh one.
- The FastAPI app's `lifespan` calls `POOL.aclose()` on shutdown. The Agent Server merges this lifespan with its own, so graph clients close with the server.

The pool lives in its own module, always imported by package name, because langgraph loads `graph.py` from its file path under a generated module name; a pool kept in `graph.py` would exist once per copy and the app's lifespan would close the wrong one. `test_shutdown_closes_the_clients_of_the_graph_langgraph_loads` loads `graph.py` by path, builds a classifier inside a `TestClient` session, and checks its clients are closed afterwards. `test_classifiers_share_one_connection_pool` checks that classifiers for different System 1 models share the same clients.

## `ChessContext`: the runtime knobs

`ChessContext` is a keyword-only dataclass. It is also the graph's `context_schema`. Each field carries a pydantic `Field` description and `json_schema_extra={"langgraph_nodes": [...]}`, which tells Studio which nodes the knob affects (`model` and/or `SystemOneMiddleware.before_model`). Numeric knobs carry pydantic bounds, enforced when the context is resolved.

| Knob | Default | Effect |
| --- | --- | --- |
| `policy` | `"hybrid"` | `llm`, `systemone` or `hybrid` (see above). |
| `model` | `"langsmith:baseten/zai-org/GLM-5.3-Flash"` | `init_chat_model` spec. `langsmith:<provider>/<model>` goes through the LLM Gateway; `provider:model` and bare names need that provider's package. |
| `reasoning_effort` | `None` | `low` / `medium` / `high`, or `None` to send no effort (required for non-reasoning models). |
| `show_legal_moves` | `True` | List the legal moves in the prompt. |
| `memory` | `"none"` | `none` / `summarize`. `summarize` needs a known input limit. Ignored for `systemone`. |
| `systemone_model` | `"semif-qwen3.5-4b"` | Or `typesafe/jev-latest`. |
| `style` | `"rich"` | How legal moves are described to System 1 (`rich` / `terse`). |
| `with_eval`, `with_nouls` | `False` | Extra System 1 outputs, used for telemetry. |
| `gate` | `"margin"` | `margin` (top-1 minus top-2 probability) or `confidence`. |
| `threshold` | `0.9` | In [0, 1]. System 1 plays when the gate signal is at least this value. 0 means it always plays. 1 means it never plays and only prunes. |
| `tournament_threshold` | `None` | In [0, 1]. Threshold after a tournament. `None` means use `threshold`. |
| `k` | `5` | Number of candidates suggested to the model, from 1 to `CHOICE_LIMIT` (255). |
| `top_p` | `None` | In (0, 1]. Cut suggestions by probability mass instead of a fixed `k`. |
| `draw_claims` | `"auto"` | End the game on threefold repetition or the fifty-move rule. `never` turns this off. |
| `seed` | `0` | Seed for System 1's tournament shuffle. |

The repository contains no production trace data that shows which of these defaults real runs use. Check [runtime behavior](/openwiki/operations/runtime-behavior.md) for observed patterns. Two things are known from the code: the web client sends every knob on each submit (see below), and the live tests override `policy`, `seed` and `threshold`.

## `resolve_context`: assistant context, then `configurable`

Knobs arrive two ways. Studio and the SDK set them as assistant **context**. The web UI puts them in the run's **`config["configurable"]`**. `resolve_context(schema, config, runtime)` merges them in five steps:

1. Start from the assistant context (`runtime.execution_runtime.context`). It can be a dict or a dataclass instance. A missing runtime or execution runtime counts as empty.
2. Keep only keys that are fields of the schema. Unknown keys are dropped, because the server puts its own keys (such as `thread_id`) in `configurable`.
3. Overlay the known keys from `configurable`. **Configurable wins.**
4. An explicit `None` in `configurable` overrides only a **nullable** knob (`reasoning_effort`, `tournament_threshold`, `top_p`). This lets a run clear an assistant's `top_p`. For a non-nullable knob, `None` is ignored. An omitted key keeps the assistant's value.
5. Validate the result with `TypeAdapter(schema)`, so a bad value such as `policy="jev"`, `memory="full"`, `k=0` or `threshold=1.1` fails the run up front with a `ValidationError`.

`test_context.py` covers each rule: defaults, overrides, clearing with None versus omission, dataclass context, validation failure, and the numeric bounds at and past each edge.

The web client's `configurableOf` sends exactly the `ChessContext` keys on every submit. In practice this means UI runs override all assistant context. The key list is derived from `DEFAULT_CONTEXT` in `packages/chess-ui/src/types.ts`, which hand-mirrors the Python dataclass's types and defaults (and the `setup` state key); `apps/web/src/settings.ts` adds per-knob validation (`CONTEXT_CHECKS`, with the same ranges as the Python bounds) for stored settings and recorded setups. When you add or change a knob, update the Python dataclass, `types.ts`, and `CONTEXT_CHECKS`. See [web frontends](/openwiki/architecture/web-frontends.md).

## `ServerSettings`

`ServerSettings` is a pydantic-settings class. It reads the shell first, then `.env`, and ignores unknown keys. It deliberately holds no model credentials: chat models read their providers' own environment variables (or `LANGSMITH_GATEWAY*`) themselves. It reads three variables:

- `LANGSMITH_GATEWAY_API_KEY` is read only so that a blank value can be rejected. The `.env` template expands it from a shell variable. If that expansion produces an empty string, langchain-core would otherwise fall back to the tracing key without any warning.
- `TYPESAFE_API_KEY` and `TYPESAFE_BASE_URL` are the System 1 credentials. `typesafe()` returns them and raises `ValueError("System 1 needs TYPESAFE_API_KEY and TYPESAFE_BASE_URL")` if either is missing.

A variable that is **set but empty** is a validation error, not the same as unset. Because `typesafe()` is called only while building System 1 middleware, an `llm`-only graph builds without TypeSafe settings, while `hybrid` fails at build time. `test_systemone_needs_typesafe_settings_only_when_it_runs` covers this. `make_graph` builds a fresh `ServerSettings()` on every run; `shape()` reads no settings at all.

## The FastAPI app: `/ui`, `/ui/config` and `/ui/model-limit`

`app.py` exposes `app = create_app()`, a FastAPI app with the docs, redoc and OpenAPI routes turned off and the pool-closing `lifespan` attached. It has these routes:

- `GET /ui/config` returns `ui_config()`: `{"graph": "chess", "schema": <ChessContext JSON schema>, "defaults": <asdict(ChessContext())>}`. The schema includes the `langgraph_nodes` extras and the field defaults. The current web client does not fetch this route and uses hand-mirrored defaults instead. The live test uses it to check that the app is mounted.
- `GET /ui/model-limit?model=<spec>` returns `{"max_input_tokens": model_limit(model)}`, an integer or `null`. The `model` query parameter is required (omitting it gives 422). The web client's `fetchModelLimit` calls it and returns one of three results: `known` (with the token count), `none` (the server answered `null`: no known limit or the model can't be built), or `failed` (non-OK response, malformed body or network error), which says nothing about the model.
- `GET /ui` redirects (307) to `/ui/`.
- `/ui/` serves the static Vite build from `langchain_chess_server/static` through `StaticFiles(html=True)`, when that directory exists. The directory is produced in CI just before `langgraph deploy`, so a plain checkout doesn't have it. In that case `/ui/` returns a 404 JSON response that suggests `mise run build` or `vp dev`, and `/ui/config` and `/ui/model-limit` still work.

Two design constraints come from the source comments:

- **Why `/ui` and not `/`.** Custom routes shadow the Agent Server's own routes, and `/` is the server's health check. Mounting the UI at the root would break the health check.
- **Why `app.mount` and not `app.frontend()`.** Routes added with `app.frontend()` have low priority. The Agent Server has its own `/ui` mount (`langgraph_api/api/ui.py`), which would answer first, and the chess UI would never load. An explicit `app.mount("/ui", ...)` takes priority.

In production the web client calls the graph API on the same origin (`window.location.origin`). During development, `vp dev` talks to `langgraph dev` on `http://localhost:2024` (or `VITE_API_URL` when set).

## Tests that matter

- `apps/server/tests/test_graph.py` covers the identical topology of runs and reads for every policy and memory, reads without credentials, the `llm` policy never calling System 1, the `setup` recording rules (first turn, game-ending first turn, failed first turn, rejected input, legacy threads), the gateway chat model (budget, name, profile from the context window, small-window split), omitting `reasoning_effort` when unset, the TypeSafe requirement applying only to System 1 policies, System 1 alone forcing threshold 0, the shared connection pool, the summarize input-limit guard, the removal of `memory="full"`, and `model_limit` agreeing with the agent.
- `apps/server/tests/test_context.py` covers the merge, validation and bounds rules of `resolve_context`.
- `apps/server/tests/test_clients.py` covers single creation under concurrent first use and closing/recreating the pool.
- `apps/server/tests/test_app.py` covers the `/ui/config` payload, the routes without a build (redirect, 404), the `/ui/model-limit` route (known, unknown, missing parameter), serving a static build, and shutdown closing the clients of a path-loaded `graph.py`.
- `apps/server/tests/test_live.py` is opt-in (`-m live`) and costs money. It runs a real `langgraph dev` from `langgraph.json` and checks that the `/ui` app is mounted, that assistant context reaches the factory through `runtime`, that a full game plays on the server, and that the recorder prices LLM calls there.
