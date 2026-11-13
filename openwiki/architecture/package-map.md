---
type: Reference
title: Package map and dependency direction
description: The Python (uv) and JS (pnpm) packages of langchain-chess, which way their dependencies point, which layer a new feature belongs in, and how the web apps reach the agent only over HTTP or LangSmith.
tags: [architecture, packages, dependencies, workspace, monorepo]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-13T19:10:14.398Z
sources:
  - id: openwiki-source-5f219f204b3e870beec929d9
    resource: repo://.github/workflows/pages.yml
  - id: openwiki-source-c2ad925c3422b92574d65d56
    resource: repo://apps/review/package.json
  - id: openwiki-source-dfc7df2cd3a44dc2766bff5e
    resource: repo://apps/review/README.md
  - id: openwiki-source-b9886f4aee6bc16bdaea61ff
    resource: repo://apps/server/langchain_chess_server/app.py
  - id: openwiki-source-d6b546398e3b1c03ecb0494a
    resource: repo://apps/server/langchain_chess_server/auth.py
  - id: openwiki-source-72cff634549a72fbc164bc15
    resource: repo://apps/server/langchain_chess_server/clients.py
  - id: openwiki-source-9e73cfc78a8aeac72fc36a15
    resource: repo://apps/server/langchain_chess_server/codegen.py
  - id: openwiki-source-65aad166aa88a58cc7a8319a
    resource: repo://apps/server/langchain_chess_server/context.py
  - id: openwiki-source-88d085345a1ecd09c61f7ab0
    resource: repo://apps/server/langchain_chess_server/game_setup.py
  - id: openwiki-source-c9b903d37e22daedc4499a4b
    resource: repo://apps/server/langchain_chess_server/graph.py
  - id: openwiki-source-e3b0d2af80ee0702b2be4a6b
    resource: repo://apps/server/langchain_chess_server/settings.py
  - id: openwiki-source-f5485618fdea35eba238fd7b
    resource: repo://apps/server/pyproject.toml
  - id: openwiki-source-af9ed044b3462b6126b95a6e
    resource: repo://apps/server/README.md
  - id: openwiki-source-bae425afdb2f1082f5506562
    resource: repo://apps/server/tests/test_codegen.py
  - id: openwiki-source-99de51df25f29bfc72caf823
    resource: repo://apps/web/package.json
  - id: openwiki-source-fde4d91838391ae51474c06b
    resource: repo://apps/web/src/auth/check.ts
  - id: openwiki-source-fe293e29941663c7d6f751f0
    resource: repo://apps/web/src/auth/config.ts
  - id: openwiki-source-5709a1f77481433dd9c7eea2
    resource: repo://apps/web/src/auth/oauth.ts
  - id: openwiki-source-958c86b14cece0555a5ab2c3
    resource: repo://apps/web/src/auth/session.ts
  - id: openwiki-source-7f2e3520a656d432bb97cc86
    resource: repo://apps/web/src/modelFacts.ts
  - id: openwiki-source-f2887a22b7d95aeb9307ea2d
    resource: repo://apps/web/src/Root.tsx
  - id: openwiki-source-611421396243f4b643f6d94a
    resource: repo://apps/web/src/useGame.ts
  - id: openwiki-source-03f6dd3375679341910a29c1
    resource: repo://apps/web/vite.config.ts
  - id: openwiki-source-1e593e9ea3114c009929aa6d
    resource: repo://evals/langchain_chess_evals/systemone/experiment.py
  - id: openwiki-source-f5c8fd59795ecae3b7e5d183
    resource: repo://evals/langchain_chess_evals/systemone/scoring.py
  - id: openwiki-source-c5b4e34d336b7c9431470f11
    resource: repo://evals/pyproject.toml
  - id: openwiki-source-4cff47e1292e04993d94f67a
    resource: repo://evals/reports/package.json
  - id: openwiki-source-5bbba7b2a8ea8360ff233d63
    resource: repo://langgraph.json
  - id: openwiki-source-3ecb0a4670bd2a3c2f04fe71
    resource: repo://libs/chess/langchain_chess/__init__.py
  - id: openwiki-source-65bee4ff16ecbe51243c1e47
    resource: repo://libs/chess/langchain_chess/chat_models.py
  - id: openwiki-source-58ce79eace88f6d2b5c95962
    resource: repo://libs/chess/pyproject.toml
  - id: openwiki-source-5cb9a92cfa0c294e20b8d861
    resource: repo://libs/cli/langchain_chess_cli/grade/batch.py
  - id: openwiki-source-abe54986bd51a87223916132
    resource: repo://libs/cli/langchain_chess_cli/main.py
  - id: openwiki-source-595fa5f62bc6bdbfd212eed8
    resource: repo://libs/cli/langchain_chess_cli/options.py
  - id: openwiki-source-209a02af6c0ad75814326da0
    resource: repo://libs/cli/pyproject.toml
  - id: openwiki-source-c228b1f5ddeb31cb2374ed59
    resource: repo://libs/systemone/langchain_chess_systemone/agent.py
  - id: openwiki-source-3c3f476720af9ceef23b678d
    resource: repo://libs/systemone/langchain_chess_systemone/middleware.py
  - id: openwiki-source-79af0d552c660a058f4241b8
    resource: repo://libs/systemone/langchain_chess_systemone/ranker.py
  - id: openwiki-source-21de6a067affac443ab60933
    resource: repo://libs/systemone/langchain_chess_systemone/settings.py
  - id: openwiki-source-ead3c485baf49d346717a69c
    resource: repo://libs/systemone/pyproject.toml
  - id: openwiki-source-72b5d686f860ea86c8592080
    resource: repo://mise.toml
  - id: openwiki-source-0c21b06ab993756e943b973e
    resource: repo://packages/chess-ui/package.json
  - id: openwiki-source-a2159d5515f3a1f98d1230a7
    resource: repo://packages/chess-ui/src/index.ts
  - id: openwiki-source-8f4a6ef492dd86b6058c2cff
    resource: repo://packages/chess-ui/src/stages.ts
  - id: openwiki-source-fd0e9360c0eb5b2cec5ea440
    resource: repo://packages/chess-ui/src/types.ts
  - id: openwiki-source-40275cb92c3610938f16ade3
    resource: repo://pnpm-workspace.yaml
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "openwiki/0.9.0", at: "2026-11-13T19:10:14.398Z" }
---

# Package map and dependency direction

The repository is two workspaces side by side: a **uv workspace** of Python distributions that build and serve the chess agent, and a **pnpm workspace** of TypeScript apps that display it. They never import each other. The browser apps reach the Python side over HTTP (the Agent Server API plus one custom route) or through LangSmith, and Python settings types reach TypeScript only through committed generated files.

Related pages: [Web frontends](web-frontends.md), [Agent Server integration](../integrations/agent-server.md), [Deployment](../operations/deployment.md), [Quickstart](../quickstart.md).

## The two workspaces

### Python (uv)

The root `pyproject.toml` is a virtual workspace with no package of its own. Its members are listed explicitly as `libs/chess`, `libs/systemone`, `libs/cli`, `apps/server` and `evals`, because a glob over `apps/` would pick up `apps/web`, which has no `pyproject.toml`.

Workspace sources (`workspace = true`) are declared only in the root `pyproject.toml`. That lets `uvx --from git+…#subdirectory=libs/cli` resolve the unpublished siblings from the same commit. Member-level workspace sources would fail in the Agent Server image, where each member is installed on its own.

| Distribution | Import package | Role |
|---|---|---|
| `langchain-chess` (`libs/chess`) | `langchain_chess` | Core: `create_chess_agent`, game state, middleware contract, chat-model factory, engine and grading |
| `langchain-chess-systemone` (`libs/systemone`) | `langchain_chess_systemone` | `SystemOneMiddleware`, rankers, `ChessContext` settings, the shared `build_agent` |
| `langchain-chess-cli` (`libs/cli`) | `langchain_chess_cli` | The `lcchess` command (`play`, `uci`, `grade`) |
| `langchain-chess-server` (`apps/server`, private) | `langchain_chess_server` | The `chess` graph factory, auth handler, `/model-facts` route, settings codegen |
| `langchain-chess-evals` (`evals`, private) | `langchain_chess_evals` | Positions dataset and System 1 experiments (`lcchess-evals`) |

### JavaScript (pnpm)

`pnpm-workspace.yaml` lists `apps/web`, `apps/review`, `evals/reports` and `packages/*`. `apps/server` is not in it because it has no `package.json`. A shared version **catalog** in the same file keeps the apps and `packages/chess-ui` from drifting on shared dependencies such as React, Vite+, chess.js and the macaw components.

| Package | Role |
|---|---|
| `packages/chess-ui` (`@langchain-chess/chess-ui`) | Board, move list, move details, state types and generated settings shared by the apps |
| `apps/web` (`langchain-chess-web`) | The React game UI, hosted on GitHub Pages |
| `apps/review` | LangSmith custom app that replays graded games |
| `evals/reports` | Report UI for the evals |

`apps/web`, `apps/review` and `evals/reports` all depend on `@langchain-chess/chess-ui` via `workspace:*`. chess-ui has no build step. Its `exports` point straight at TypeScript source (`src/index.ts`, `src/styles.css`, `src/testing.ts`).

## Dependency direction

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: an unescaped angle bracket inside a label breaks rendering; rephrase the label. -->
```text
flowchart TD
  core["langchain-chess<br/>libs/chess"]
  s1["langchain-chess-systemone<br/>libs/systemone"]
  cli["langchain-chess-cli<br/>libs/cli"]
  server["langchain-chess-server<br/>apps/server"]
  evals["langchain-chess-evals<br/>evals"]
  chessui["chess-ui<br/>packages/chess-ui"]
  web["apps/web"]
  review["apps/review"]
  reports["evals/reports"]
  ls[("LangSmith")]

  s1 --> core
  cli --> s1
  cli --> core
  server --> s1
  server --> core
  evals --> s1
  evals --> core
  web --> chessui
  review --> chessui
  reports --> chessui
  web -. HTTP .-> server
  review -. LangSmith API .-> ls
  server -. "codegen writes generated/" .-> chessui
```

*Solid arrows are package dependencies. Dotted arrows are runtime or build-time links that are not imports.*

- **systemone → core.** `langchain-chess-systemone` depends on `langchain-chess`. Its `SystemOneMiddleware` builds on `ChessMiddleware`, `ChessState` and `PositionView`, and its ranker records calls using `langchain_chess` pricing and state types.
- **core never imports systemone.** The only link back is an optional `systemone` extra on `langchain-chess` that installs the sibling. The CLI depends on `langchain-chess[systemone]`.
- **Shared agent assembly.** `langchain_chess_systemone.agent.build_agent` turns a `ChessContext` into the graph for every surface. It calls only the factories the policy uses, so policy `systemone` builds no chat model. It adds `SystemOneMiddleware` for every policy except `llm`. For `llm` it adds `NoSystemOne` only when `fixed_topology=True`. The CLI's `uci`/`play` commands and the server's `build_graph` both call it rather than keeping their own. It keeps memory on only when there is a chat model, and it raises `ChessContractError` when memory is requested for a model with no known input limit.
- **Chat models come from core.** `langchain_chess.chat_models.chat_model` builds them. `build_agent`'s `default_model` uses it for the CLI. The server's `server_model` uses it with model arguments restricted to the `server` surface.
- **Settings live in systemone.** `ChessContext`, the versioned settings model for every surface, extends `langchain_chess.settings.CoreSettings`. The CLI builds it from an optional settings file overlaid with flags. The server resolves it from assistant context, then from configurable.
- **CLI grading reuses core.** `lcchess grade` uses `langchain_chess.engine` and `langchain_chess.grading` and does not implement grading itself. The CLI exposes the `lcchess` script from `langchain_chess_cli.main:app`.
- **Server and evals are private leaves.** `langchain-chess-server` carries the `Private :: Do Not Upload` classifier. `langchain-chess-evals` depends on core and systemone (`GatewayRanker`, `ChessContext` settings files, core grading and rules) and exposes `lcchess-evals`. No other package imports either one.

## What only the server adds

`apps/server` is a thin layer over the shared `build_agent`:

- **`build_graph`** passes `GameSetupMiddleware` as extra middleware, `fixed_topology=True` and `context_schema=ChessContextInput`, and attaches the settings as sent for the `server` surface as run metadata.
- **`make_graph`** returns a model-free `shape()` graph (`NoSystemOne` plus `GameSetupMiddleware`, fixed topology) when there is no execution runtime. Every factory call must build the same nodes and state schema, so a setting may switch a node off but never remove it.
- **`GameSetupMiddleware`** records the run's resolved `ChessContext` as a non-private `setup` state key, on a game's first turn only, so any client can continue a game from its thread.
- **`pooled_ranker`** injects the server's own ranker factory. For an `openai/` System 1 model, its `GatewayRanker` uses an OpenAI Decisions classifier with `httpx` clients from `DECISIONS_POOL`. Otherwise it uses a `langchain_typesafe` `TypeSafeClassifier` with credentials from `ServerSettings.typesafe()` (`TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL`) and `httpx2` clients from `POOL`. The CLI uses `build_agent`'s `default_ranker`, which is a plain `GatewayRanker`.
- **`auth.py`** verifies Bearer tokens against LangSmith's JWKS with pyjwt. It admits only tokens issued to the configured OAuth client for the allowed organization. Requests without an `Authorization` header fall through to LangSmith's API-key check (`allow_langsmith_api_keys`).

### `langgraph.json` wiring

The Agent Server image builds from the uv workspace with `langchain-chess-server` as the package. `dockerfile_lines` ADD the `pyproject.toml` of `libs/chess`, `libs/systemone`, `libs/cli` and `apps/server` (not `evals`). The file wires the `chess` graph to `graph.py:make_graph`, auth to `auth.py:auth` with `allow_langsmith_api_keys` enabled, and the custom HTTP app to `app.py:app`.

### The custom HTTP app

`app.py` is deliberately tiny. It serves no UI, because GitHub Pages hosts the UI. Its FastAPI app (docs and OpenAPI disabled) exposes one route, `GET /model-facts?model=…`, which returns `max_input_tokens` (from the cached `model_limit`, or null if the model has no known limit or can't be built) and `takes_effort`. Its lifespan, which the Agent Server merges with its own, closes the process-wide `POOL` and `DECISIONS_POOL` on shutdown. Custom routes shadow the Agent Server's own, so new routes must stay clear of its API (`/threads`, `/runs`, `/assistants`, `/store`, `/ui`, `/ok`, …).

## How the web apps reach the agent

**apps/web talks to the agent only over HTTP.** The API URL comes from `VITE_API_URL`, with a local dev default.

- It drives the `chess` graph with `useStream` from `@langchain/react`, through a session-aware `@langchain/langgraph-sdk` client (`sessionClient`). That client adds fresh credentials to every request and stream: none, `x-api-key`, or `Bearer`.
- It calls `GET /model-facts` to decide whether to offer memory and a reasoning effort. Any failure is reported as `failed`.
- It checks access with `POST /assistants/search`, the cheapest authenticated call. Only 401 and 403 count as refusal.
- It takes context defaults (`DEFAULT_CONTEXT`) from chess-ui and fetches no server config.

Sign-in lives entirely in `apps/web/src/auth/`. That covers config from `VITE_OAUTH_CLIENT_ID`, `VITE_LANGSMITH_ORGANIZATION_ID` and `VITE_LANGSMITH_SSO_SLUG`, the `Session` type and its headers, the `oidc-client-ts` LangSmith OAuth flow, the access check, `SignIn` and `useSession`. `Root.tsx` composes them and renders `App` only when signed in.

**Build and hosting.** The Vite+ build writes to `dist` by default. `OUT_DIR` overrides the output directory and `BASE_PATH` the base URL. The build has two inputs: `index.html` (the app) and `render.html`, LangSmith's custom output renderer for the evals positions dataset. The `pages` workflow builds with `BASE_PATH=/<repo>/` and `VITE_API_URL` and publishes `apps/web/dist` to GitHub Pages. The server does not serve the UI. See [Deployment](../operations/deployment.md).

**apps/review does not talk to the agent.** It reaches only the LangSmith API through `window.langsmith.call`. It reads threads, each game's last root run and the grader's `game_review` feedback. Its Analyze action writes a `grade_status` mark and launches `lcchess grade --sandbox-job` in a LangSmith sandbox. Because it depends on chess-ui via `workspace:*`, it can only be built from a checkout of this repo.

## Python → TypeScript types

- **Settings are generated.** `python -m langchain_chess_server.codegen` (`mise run generate:settings`) renders `settings.ts`, `settings.schema.json` and `opponent.schema.json` into `packages/chess-ui/src/generated`. It works from `ChessContext`'s schemas, version defaults and the `model_kwargs` rules, and chess-ui re-exports the generated module. The files are committed. `apps/server/tests/test_codegen.py` fails when they differ from current output, so a Python settings change must regenerate and commit them in the same change.
- **State types are hand-maintained.** `packages/chess-ui/src/types.ts` mirrors `langchain_chess/state.py` and `langchain_chess_systemone/types.py` by hand. The server's `setup` state key is typed as `unknown` and read with `loadRecorded`.

## Where a new feature belongs

| Change | Layer |
|---|---|
| Game rules, state, prompts, core middleware contract, chat-model construction, grading | `libs/chess` (must not import systemone) |
| System 1 ranking/gating, new `ChessContext` settings, agent assembly shared by all surfaces | `libs/systemone` (`build_agent`); then run `generate:settings` |
| Terminal, UCI or grading command behaviour | `libs/cli` |
| Deployment-only behaviour: auth, pooled clients, `setup` recording, a new HTTP route for the web UI | `apps/server` (keep graph topology fixed; avoid Agent Server route names) |
| Board/move-list UI or TS state types used by more than one app | `packages/chess-ui` |
| Game-screen UI, sign-in, calling the server | `apps/web` (over HTTP only) |
| Replay or grade-launch UI for graded games | `apps/review` (LangSmith API only) |
| Datasets and experiments | `evals` |

## Tests and coverage

Python tests run from the root over all five packages' `tests` directories (`--import-mode=importlib`, `asyncio_mode = "auto"`). Coverage covers all five import packages, with branch coverage on and a 100% `fail_under`. Tests marked `live` (real LLM Gateway) or `e2e` (browser) are excluded by default. The JS packages run Vitest through `vp test --run --coverage`, and `apps/web` sets 100% thresholds for lines, functions, branches and statements over `src/`.
