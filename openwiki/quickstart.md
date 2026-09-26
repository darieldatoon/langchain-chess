---
type: quickstart
title: "Quickstart: working in langchain-chess"
description: Entry point for coding agents changing langchain-chess — what the repo is, the Python/JS package map and dependency direction, the mise dev/check/test commands, the rules every change must keep, and a task-routing table to the rest of the wiki.
tags: [quickstart, overview, package-map, development, routing]
sources:
  - id: openwiki-source-88d085345a1ecd09c61f7ab0
    resource: repo://apps/server/langchain_chess_server/game_setup.py
  - id: openwiki-source-c9b903d37e22daedc4499a4b
    resource: repo://apps/server/langchain_chess_server/graph.py
  - id: openwiki-source-e3b0d2af80ee0702b2be4a6b
    resource: repo://apps/server/langchain_chess_server/settings.py
  - id: openwiki-source-f5485618fdea35eba238fd7b
    resource: repo://apps/server/pyproject.toml
  - id: openwiki-source-611421396243f4b643f6d94a
    resource: repo://apps/web/src/useGame.ts
  - id: openwiki-source-5bbba7b2a8ea8360ff233d63
    resource: repo://langgraph.json
  - id: openwiki-source-3ae14faf8cc85a90b40ed182
    resource: repo://libs/chess/langchain_chess/agent.py
  - id: openwiki-source-65bee4ff16ecbe51243c1e47
    resource: repo://libs/chess/langchain_chess/chat_models.py
  - id: openwiki-source-e92c3d9adb77a4ffddf28116
    resource: repo://libs/chess/langchain_chess/prompt.py
  - id: openwiki-source-58ce79eace88f6d2b5c95962
    resource: repo://libs/chess/pyproject.toml
  - id: openwiki-source-209a02af6c0ad75814326da0
    resource: repo://libs/cli/pyproject.toml
  - id: openwiki-source-3c3f476720af9ceef23b678d
    resource: repo://libs/systemone/langchain_chess_systemone/middleware.py
  - id: openwiki-source-ead3c485baf49d346717a69c
    resource: repo://libs/systemone/pyproject.toml
  - id: openwiki-source-72b5d686f860ea86c8592080
    resource: repo://mise.toml
  - id: openwiki-source-40275cb92c3610938f16ade3
    resource: repo://pnpm-workspace.yaml
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "openwiki/0.6.0", at: "2026-09-26T14:00:37.632Z" }
verified:
  - by: openwiki/0.6.0
    at: 2026-09-26T14:00:37.632Z
---

# Quickstart: working in langchain-chess

langchain-chess builds chess-playing agents on LangChain's `create_agent`. The design is simple: **everything that decides how a move is chosen is middleware, and everything that talks to the agent is an adapter outside the graph.** Legality, forced moves, the System 1 ranker (SemIf or Jev) and memory summarization are all middleware. The UCI engine, the terminal UI, the Agent Server graph with its web UI, and the grader are all adapters.

"System 1 + System 2" is a single middleware. A cheap ranker scores the legal moves. If its confidence gate clears, it plays the move and the LLM never runs. If not, it hands over a shortlist and the LLM can still play any legal move. Details are in [System 1](architecture/system-one.md).

## Package map

```mermaid
flowchart TD
    subgraph Python["Python - uv workspace"]
        chess["libs/chess - langchain_chess"]
        s1["libs/systemone - langchain_chess_systemone"]
        cli["libs/cli - lcchess uci, play, grade"]
        server["apps/server - chess graph and /ui app"]
    end
    subgraph JS["JavaScript - pnpm and Vite+"]
        ui["packages/chess-ui - TS source, no build"]
        web["apps/web - React UI at /ui"]
        review["apps/review - LangSmith custom app"]
    end
    s1 --> chess
    cli --> chess
    cli --> s1
    server --> chess
    server --> s1
    web --> ui
    review --> ui
    web -. "HTTP (useStream)" .-> server
    server -. "serves built UI" .-> web
```
*Arrows show "depends on". Solid arrows are package dependencies. Dotted arrows are runtime-only links.*

| Package | Import / binary | Role |
|---|---|---|
| `libs/chess` (`langchain-chess`) | `langchain_chess` | `create_chess_agent`, `ChessState`, the middleware contract and write guard, `ChessCore`, `chat_model` (in `chat_models.py`), the call recorder and pricing, grading math, test fakes |
| `libs/systemone` (`langchain-chess-systemone`) | `langchain_chess_systemone` | `SystemOneMiddleware`, `NoSystemOne`, `GatewayRanker`, the tournament |
| `libs/cli` (`langchain-chess-cli`) | `lcchess` | The UCI engine, the Textual TUI, `lcchess grade` |
| `apps/server` (private) | `langchain_chess_server` | The `chess` graph factory (`make_graph`), `GameSetupMiddleware`, and the FastAPI app serving `/ui` |
| `apps/web` | — | React UI. It talks to the `chess` graph over the Agent Server API |
| `apps/review` | — | LangSmith custom app that replays graded games |
| `packages/chess-ui` | `@langchain-chess/chess-ui` | Board, move list, ply details and state types shared by both web apps |

Dependency direction you must keep: `systemone → chess`. `cli` and `server` depend on both (`cli` through the `langchain-chess[systemone]` extra, `server` by listing both directly). **Nothing depends on `cli` or `server`.** The web apps never import Python. They reach the agent only over HTTP. `libs/chess` declares the optional `systemone` extra, but `langchain_chess` code never imports System 1. Model construction (`chat_model`) lives in `libs/chess`, so the CLI and the server build models the same way. See [Package map and dependency direction](architecture/package-map.md) to decide which layer a new feature belongs in.

### How a turn is assembled

`create_chess_agent` wraps every user middleware in the write guard and rejects two middlewares that declare the same state key. It then builds this stack: `ChessCore` first, then `ForcedMoveMiddleware` (when `forced_move=True`), then the guarded extensions, and last `ChessSummarization` (only when `memory="summarize"`). With `fixed_topology=True` and `memory="none"`, a `NoSummarization` placeholder takes the last slot so the graph's nodes don't depend on `memory`. It passes the stack to `create_agent(tools=[])` with `ChessState`. It attaches a `CallRecorder` as a callback so every provider response gets priced. It refuses to build a graph whose input schema exposes anything other than `messages` and `position`. If `model=None` it installs a `NoModel` that fails loudly. That only works when middleware always proposes a move, as a System-1-only agent does.

The server's `make_graph` builds a different graph depending on the call:

- **Runs** carry the assistant's settings. `make_graph` resolves a `ChessContext` and calls `build_agent`.
- **Runless calls** (state reads, updates, introspection) get `shape()`: no model, `NoSystemOne` and `GameSetupMiddleware`, with no clients or credentials.

Both paths use `fixed_topology=True`, so every build has the same nodes and state schema. A setting may switch a node off, but must never remove it. `build_agent` always adds `GameSetupMiddleware`, which records the run's resolved context as `setup` on the game's first turn. It selects one of three policies from `ChessContext`:

- `llm`: a chat model, with `NoSystemOne` in System 1's slot.
- `systemone`: no model, memory forced to `none`, and System 1 always plays (thresholds forced to 0).
- `hybrid`: both.

`build_agent` raises `ChessContractError` when `memory="summarize"` is requested for a model with no known input limit.

## Rules a change must keep

- **One run plays at most one turn. One thread is one game.** Input is either a chat message (`go` or one move) or a `position` that extends the thread's game. A position that doesn't extend the game is rejected. A run with no new command retries a pending turn or does nothing. → [Turn lifecycle](architecture/turn-lifecycle.md), [State record](concepts/state-record.md)
- **Clients read only `start_fen`, `moves`, `plies`, `turns`, `outcome` and `error`, plus the server's `setup`.** `messages` is model working context and may be summarized. The thread-state API also returns private channels. → [State record](concepts/state-record.md)
- **Keep the graph's topology fixed on the server.** A new server-side middleware must also go into `shape()`, or get a no-op placeholder like `NoSystemOne`. Otherwise reads made with the runless graph won't match the running graph. → [Agent Server graph](integrations/agent-server.md)
- **The middleware contract:**
  - `allowed_moves` can only narrow.
  - A turn gets at most one `proposal`, from a hook declaring `can_jump_to=["end"]`.
  - `candidates` are soft suggestions with a single writer.
  - Your own state keys are `PrivateStateAttr`.
  - No tools.
  - Every hook needs both sync and async variants.
  - `before_model` must be idempotent: a decision is frozen per turn and replayed as `current allowed ∩ frozen`.

  → [Middleware contract](concepts/middleware-contract.md)
- **Cost is computed locally.** Every provider response inside a turn, retries included, is recorded and priced with the pinned genai-prices snapshot. SemIf calls are unpriced, so a hybrid turn's cost is marked incomplete. → [Models, gateway and cost](concepts/models-gateway-and-cost.md)
- **Coverage is 100% line and branch on both halves.** Use fakes, not mocks. → [Testing conventions](testing/testing-conventions.md)
- **Image build:** `langgraph.json` builds from the uv workspace, and `dockerfile_lines` must list every member's `pyproject.toml`. Workspace sources live only in the root `pyproject.toml`. → [Deployment](operations/deployment.md)

## Commands

mise provides the tools: node, pnpm, uv, lefthook, `sfw`, fastchess, Stockfish and the `langsmith` CLI. Python comes from uv.

```sh
mise trust && mise install && mise run setup   # tools, uv sync --all-packages, pnpm install, git hooks
mise run check        # ruff format/lint + ty, then vp check (web lint, format, types)
mise run test         # pytest -n auto (100% coverage gate) + vp run -r test (Vitest)
mise run test:live    # opt-in live tests against the real gateway, `-m live --no-cov`; costs money
mise run test:uci     # two SemIf-only games under fastchess, fails on any forfeit
mise run build        # web UI into apps/server's static dir, served at /ui

mise run dev:web      # alias `dev`: langgraph dev on :2024 + web UI on :5173/ui/
                      # override with LANGGRAPH_PORT / WEB_PORT; refuses to start if a port is taken
mise run dev:tui -- --side black          # lcchess play
mise run dev:uci -- --policy systemone    # lcchess uci
mise run dev:review   # apps/review in a local LangSmith sandbox
```

Tips:

- Options after `--` pass through to the underlying command.
- `dev:web` points the UI at the chosen server port through `VITE_API_URL`. Once both servers are up it prints the web UI, API and Studio URLs, and it stops everything when either server exits.
- Plain `pytest` runs serially, which is what you want for `-k`, `--pdb` and `--snapshot-update`.
- Add dependencies with `sfw uv add --package <dist> <dep>` or `sfw pnpm add <pkg>` in the JS package that needs it.
- JS versions shared by more than one package go in the `pnpm-workspace.yaml` catalog.

**Environment.** Commands that call models load `.env` explicitly (`uv run --env-file .env …`). `langgraph dev` reads it through `langgraph.json`. The relevant variable names are:

- `LANGSMITH_GATEWAY_API_KEY`: gateway key for the default `langsmith:` model specs. `.env.example` fills it from `LC_GATEWAY_KEY`, which you export in your shell.
- `LANGSMITH_API_KEY` and `LANGSMITH_WORKSPACE_ID`: tracing.
- `TYPESAFE_API_KEY` and `TYPESAFE_BASE_URL`: System 1. The server requires them only for the policies that run System 1 (`systemone`, `hybrid`).
- `LANGSMITH_GATEWAY`: gateway passthrough for bare or `provider:model` specs.
- `STOCKFISH_PATH`: optional, for grading.

Copy `.env.example` to create `.env`. Never commit values. The server's settings reject `LANGSMITH_GATEWAY_API_KEY`, `TYPESAFE_API_KEY` or `TYPESAFE_BASE_URL` when it is set but empty, so a graph build fails instead of silently falling back. → [Local development](operations/local-development.md)

## Task routing

| I want to… | Go to |
|---|---|
| Understand which package owns what, or where a new feature belongs | [Package map and dependency direction](architecture/package-map.md) |
| Change how a turn runs: command classification, pending/abandoned turns, reply parsing, illegal-move retries, resignation, forced moves, draw claims | [Turn lifecycle](architecture/turn-lifecycle.md) |
| Tune or change System 1: gates, thresholds, `k`/`top_p`, the tournament, `NoSystemOne`, ranking retries and the `skipped` path | [System 1 (SystemOneMiddleware)](architecture/system-one.md) |
| Change the React UI, the shared board components, or how the review app displays games | [Web frontends](architecture/web-frontends.md) |
| Write a new middleware, or understand why the write guard rejected one | [The middleware contract](concepts/middleware-contract.md) |
| Add a model, change `chat_model`, gateway routing, reasoning effort, or fix cost and token accounting | [Model specs, LLM Gateway and cost](concepts/models-gateway-and-cost.md) |
| Change the prompt, `show_legal_moves`, or memory modes (`none`/`summarize`) and summarize eligibility | [Prompt and memory](concepts/prompt-and-memory.md) |
| Add or read a field in `plies`/`turns`/`setup`, or change input and thread semantics | [The client-readable state record](concepts/state-record.md) |
| Add a `ChessContext` knob, change policies, `shape()`, `GameSetupMiddleware`, the client pool, or the `/ui` mount | [Agent Server graph and /ui app](integrations/agent-server.md) |
| Change the terminal UI or shared CLI options | [Terminal UI (lcchess play)](integrations/terminal-ui.md) |
| Change the UCI adapter: time management, fallback moves, `bestmove 0000` | [UCI engine adapter](integrations/uci-engine.md) |
| Change grading, feedback keys, or the review app's data | [Grading and review](workflows/grading-and-review.md) |
| Change the image build, `langgraph.json`, CI, or deploy path filters | [Deployment and image build](operations/deployment.md) |
| Add a mise task, a git hook, a tool pin, or change the OpenWiki workflow | [Local development](operations/local-development.md) |
| Understand how turns fail and recover at runtime: model errors, System 1 failures, context validation, what the UI shows | [Runtime behavior and failure modes](operations/runtime-behavior.md) |
| Add tests, use the fakes, update TUI snapshots, or run live and fastchess tests | [Testing conventions](testing/testing-conventions.md) |
| Find out why something that looks like a gap was left out on purpose (no Anthropic prompt caching, the removed `full` memory mode), the measurements behind it, and when to revisit | [Decisions and measurements](concepts/decisions.md) |

The only memory modes are `none` and `summarize`. The earlier `full` mode was removed. Measured design decisions (prompt caching, memory mode versus analysis length) are on the [Decisions and measurements](concepts/decisions.md) page, which replaces the deleted `docs/decisions.md`. The README also points to the OpenWiki for these decisions. That page holds the current numbers, and no other page in this wiki repeats them.
