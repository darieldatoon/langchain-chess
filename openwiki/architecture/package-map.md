---
type: architecture overview
title: Package map and dependency direction
description: The Python (uv) and JavaScript (pnpm) packages in langchain-chess, which way dependencies are allowed to point (systemone -> chess, cli and server -> both, web/review -> chess-ui), and a guide to which layer a new feature belongs in.
tags: [architecture, packages, dependencies, monorepo, uv, pnpm, layering]
verified:
  - by: openwiki/0.6.0
    at: 2026-09-26T04:03:54.007Z
sources:
  - id: openwiki-source-c2ad925c3422b92574d65d56
    resource: repo://apps/review/package.json
  - id: openwiki-source-dfc7df2cd3a44dc2766bff5e
    resource: repo://apps/review/README.md
  - id: openwiki-source-b9886f4aee6bc16bdaea61ff
    resource: repo://apps/server/langchain_chess_server/app.py
  - id: openwiki-source-c9b903d37e22daedc4499a4b
    resource: repo://apps/server/langchain_chess_server/graph.py
  - id: openwiki-source-f5485618fdea35eba238fd7b
    resource: repo://apps/server/pyproject.toml
  - id: openwiki-source-99de51df25f29bfc72caf823
    resource: repo://apps/web/package.json
  - id: openwiki-source-611421396243f4b643f6d94a
    resource: repo://apps/web/src/useGame.ts
  - id: openwiki-source-03f6dd3375679341910a29c1
    resource: repo://apps/web/vite.config.ts
  - id: openwiki-source-5bbba7b2a8ea8360ff233d63
    resource: repo://langgraph.json
  - id: openwiki-source-3ecb0a4670bd2a3c2f04fe71
    resource: repo://libs/chess/langchain_chess/__init__.py
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
  - id: openwiki-source-3c3f476720af9ceef23b678d
    resource: repo://libs/systemone/langchain_chess_systemone/middleware.py
  - id: openwiki-source-79af0d552c660a058f4241b8
    resource: repo://libs/systemone/langchain_chess_systemone/ranker.py
  - id: openwiki-source-ead3c485baf49d346717a69c
    resource: repo://libs/systemone/pyproject.toml
  - id: openwiki-source-0c21b06ab993756e943b973e
    resource: repo://packages/chess-ui/package.json
  - id: openwiki-source-fd0e9360c0eb5b2cec5ea440
    resource: repo://packages/chess-ui/src/types.ts
  - id: openwiki-source-40275cb92c3610938f16ade3
    resource: repo://pnpm-workspace.yaml
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "openwiki/0.6.0", at: "2026-09-26T04:03:54.007Z" }
---

# Package map and dependency direction

langchain-chess is two workspaces in one repository:

- a **uv workspace** of four Python packages (the root `pyproject.toml` is a virtual root with no package of its own), and
- a **pnpm workspace** of three JavaScript packages (`apps/web`, `apps/review`, `packages/*`).

The main architectural rule, from the README: *everything that shapes how a move is chosen is middleware; everything that talks to the agent is an adapter outside the graph.* The package layout follows that rule. The libraries under `libs/chess` and `libs/systemone` build the agent graph. `libs/cli` and `apps/server` wrap that graph for a transport (UCI, terminal, Agent Server). The JS apps never import Python. They talk over HTTP and share their UI code through `packages/chess-ui`.

## The packages

| Path | Distribution / npm name | Import | Role | Layer |
|---|---|---|---|---|
| `libs/chess` | `langchain-chess` | `langchain_chess` | `create_chess_agent`, `ChessState`, the `ChessMiddleware` contract, core middleware (core, forced move, summarization), rules, pricing, engine grading | Core library |
| `libs/systemone` | `langchain-chess-systemone` | `langchain_chess_systemone` | `SystemOneMiddleware` plus `GatewayRanker` (SemIf/Jev System 1 ranking, tournaments) | Middleware library |
| `libs/cli` | `langchain-chess-cli` | `langchain_chess_cli` | The `lcchess` script: `uci`, `play` (Textual TUI), `grade` | Adapter |
| `apps/server` | `langchain-chess-server` (private, `Private :: Do Not Upload`) | `langchain_chess_server` | The `chess` graph factory and the FastAPI `/ui` app for the Agent Server | Adapter / deployable |
| `packages/chess-ui` | `@langchain-chess/chess-ui` (private) | TS source | The board, move list, ply details, analysis, selectors and TS mirrors of the state types | Shared UI |
| `apps/web` | `langchain-chess-web` | — | React UI, built into the server's static dir and served at `/ui` | Frontend |
| `apps/review` | `langchain-chess-review` | — | LangSmith custom app that replays graded games | Frontend |

The uv workspace members are listed explicitly (`libs/chess`, `libs/systemone`, `libs/cli`, `apps/server`), because a glob over `apps/` would pick up `apps/web`, which has no `pyproject.toml`. The pnpm workspace likewise leaves out `apps/server`, which has no `package.json`.

## Dependency direction

```mermaid
flowchart TD
    subgraph PY["Python uv workspace"]
        chess["libs/chess (langchain-chess)"]
        systemone["libs/systemone (langchain-chess-systemone)"]
        cli["libs/cli (langchain-chess-cli)"]
        server["apps/server (langchain-chess-server)"]
    end
    subgraph JS["pnpm workspace"]
        chessui["packages/chess-ui"]
        web["apps/web"]
        review["apps/review"]
    end
    LS["LangSmith API"]
    systemone --> chess
    cli --> chess
    cli --> systemone
    server --> chess
    server --> systemone
    web --> chessui
    review --> chessui
    web -. "HTTP: useStream to the chess graph" .-> server
    review -. "HTTP: threads and feedback" .-> LS
    cli -. "grade writes feedback" .-> LS
```

*Solid arrows are package dependencies. Dotted arrows are runtime HTTP calls; they are not imports.*

What the manifests and imports establish:

- **`systemone -> chess`.** `langchain-chess-systemone` depends on `langchain-chess`. Its middleware subclasses `ChessMiddleware` and reads `ChessState`/`PositionView`. Its ranker records calls through `langchain_chess.pricing.make_call` and `langchain_chess.state.Call`.
- **`chess` imports nothing from the other packages.** `langchain_chess` never imports `langchain_chess_systemone`. The only reverse link is packaging: `langchain-chess` declares an optional extra, `langchain-chess[systemone]`, which installs the sibling package. The CLI uses that extra (`langchain-chess[systemone]`) to get both libraries in one requirement. Treat the extra as a convenience for installs. It is not permission to import systemone from core code.
- **`cli -> chess, systemone` and `server -> chess, systemone`.** Both adapters call `create_chess_agent` and build a `SystemOneMiddleware` themselves (`libs/cli/langchain_chess_cli/options.py`, `apps/server/langchain_chess_server/graph.py`). They also reuse core helpers such as `langchain_chess.models.model_identity`/`GATEWAY_PREFIX` and the summarization prompt constants. The CLI's `grade` command additionally uses `langchain_chess.engine` and `langchain_chess.grading`.
- **Nothing depends on `cli` or `server`.** They are leaves. The two adapters don't import each other, so each keeps a small parallel `chat_model`/SystemOne construction of its own. The server is marked private and never published.
- **Web and review share `packages/chess-ui` as TypeScript source.** Both depend on `@langchain-chess/chess-ui` through `workspace:*`. The package's `exports` point straight at `./src/index.ts`, `./src/styles.css` and `./src/testing.ts`, with no build step. One consequence: `apps/review` can only be built from a checkout of this repo.
- **The JS side reaches Python only over HTTP.** `apps/web` drives the `chess` graph through `useStream` from `@langchain/react` (`apps/web/src/useGame.ts`). It does not fetch `/ui/config`: its context defaults are hand-mirrored in `packages/chess-ui/src/types.ts`. `apps/review` doesn't talk to the agent at all. It reads threads and the grader's `game_review` feedback from the LangSmith API through the sandbox's `window.langsmith.call`.

### The hand-maintained type bridge

There is no generated contract between Python and TS. `packages/chess-ui/src/types.ts` mirrors `langchain_chess/state.py`, `langchain_chess_systemone/types.py` and `ChessContext` in `apps/server/.../context.py`, and a header comment says to "keep them in step by hand". If you change state keys, ply metadata or context fields in Python, update the mirror in the same change. Otherwise the UIs will misread the thread state.

## Shared tooling that spans packages

- **Workspace sources live only in the root `pyproject.toml`.** Every member has `workspace = true` under `[tool.uv.sources]` there, so `uvx --from git+…#subdirectory=libs/cli` can resolve the unpublished siblings from the same commit. A member-level `workspace = true` source breaks the Agent Server image, because each member is installed there on its own.
- **The deployment image** builds from the uv workspace with `langchain-chess-server` as the package (`langgraph.json` `source`). `dockerfile_lines` has to `ADD` every member's `pyproject.toml`. Keep that list in step with the workspace members when you add a package. `langgraph.json` also wires the graph (`chess` → `graph.py:make_graph`) and the HTTP app (`app.py:app`). See [Deployment](../operations/deployment.md).
- **The web build output** goes to `apps/server/langchain_chess_server/static` (the `outDir` in `apps/web/vite.config.ts`). The server mounts that directory at `/ui` when it exists. This is a build-artifact link, not a code dependency.
- **Tests and coverage** run from the root. `testpaths` covers all four Python packages, and coverage is measured over all four import packages with `--cov-fail-under=100`. Live tests (`-m live`) are excluded by default. Vitest runs per JS package, also at 100% coverage.
- **Shared JS versions** live in the `pnpm-workspace.yaml` `catalog`, so the apps and `packages/chess-ui` can't drift apart on React, chess.js, react-chessboard, Vite+, and so on.

## Where does a new feature go?

```mermaid
flowchart TD
    Q["New feature"] --> A{"Changes how a move is chosen?"}
    A -- yes --> B{"Needs System 1 ranking or the typesafe client?"}
    B -- yes --> SO["Middleware in libs/systemone"]
    B -- no --> CH["Middleware in libs/chess or a new lib depending on it"]
    A -- no --> C{"Talks to the agent from outside?"}
    C -- "terminal, UCI, grading" --> CLI["Adapter in libs/cli"]
    C -- "hosted graph or HTTP routes" --> SRV["apps/server"]
    C -- no --> D{"Browser UI?"}
    D -- "used by both apps" --> UI["packages/chess-ui"]
    D -- "one app only" --> APP["apps/web or apps/review"]
```

*Decision guide for placing a feature. The layer determines which package it may import.*

- **Move-choice logic is middleware.** Legality narrowing, proposals, candidate suggestions, and anything that inspects the position before the model runs belong in an `AgentMiddleware`/`ChessMiddleware`. General-purpose behaviour goes in `libs/chess`. System 1 ranking and anything that needs `langchain-typesafe` goes in `libs/systemone`. A new family of policies can be a new library under `libs/` that depends on `langchain-chess`, the way systemone does. Middleware must follow the write-guard contract: narrow-only `allowed_moves`, one proposal per turn, private state keys, an idempotent `before_model`, and sync and async hooks. See [Middleware contract](../concepts/middleware-contract.md).
- **Game-rule, record, pricing or grading helpers** that more than one adapter needs belong in `libs/chess` (as with `rules`, `pricing`, `engine`, `grading`). Don't put them in an adapter and then import across adapters.
- **Adapters stay outside the graph.** A new transport (a new CLI command, a UCI option, a bot integration) goes in `libs/cli` or a new leaf package. Changes to what the hosted graph exposes (context knobs, routes, settings) go in `apps/server`; see [Agent Server integration](../integrations/agent-server.md). Adapters configure the agent with `create_chess_agent(..., middleware=[...])`. They must not reach into or mutate core-owned state.
- **UI components shared by both web apps** (board, move list, ply details, formatting, selectors, state types) go in `packages/chess-ui`. Components used by only one app stay in that app. See [Web frontends](../architecture/web-frontends.md).
- **Never add an import that points upward.** Examples: `langchain_chess` importing `langchain_chess_systemone`, any library importing `langchain_chess_cli` or `langchain_chess_server`, or a JS package importing Python-generated code.

## Related pages

- [Quickstart](../quickstart.md)
- [Middleware contract](../concepts/middleware-contract.md)
- [Web frontends](../architecture/web-frontends.md)
- [Agent Server integration](../integrations/agent-server.md)
- [Deployment](../operations/deployment.md)
