# langchain-chess

Chess agents built on LangChain's `create_agent`. Everything that shapes how a move is chosen
is middleware: legality checks, forced moves, a System 1 ranker (SemIf or Jev) and memory
summarization. Everything that talks to the agent is an adapter outside the graph: a UCI
engine, an Agent Server app with a web UI, and a terminal UI.

The System 1 + System 2 idea is one middleware. A System 1 model ranks the legal moves. If its
confidence gate clears, it plays the move and the LLM never runs. Otherwise it suggests a
shortlist, and the LLM may still play any legal move.

| Package | Import | What it is |
|---|---|---|
| `libs/chess` (`langchain-chess`) | `langchain_chess` | `create_chess_agent`, the state, the middleware contract |
| `libs/systemone` (`langchain-chess-systemone`) | `langchain_chess_systemone` | `SystemOneMiddleware` and the gateway ranker |
| `libs/cli` (`langchain-chess-cli`) | `langchain_chess_cli` | `lcchess uci` and `lcchess play` |
| `apps/server` (private) | `langchain_chess_server` | The `chess` graph and the `/ui` app for LangSmith Deployments |
| `apps/web` | | The React UI served at `/ui` |

## Quickstart

```python
from langchain.chat_models import init_chat_model
from langgraph.checkpoint.memory import InMemorySaver

from langchain_chess import create_chess_agent

agent = create_chess_agent(
    init_chat_model("langsmith:anthropic/claude-opus-5", reasoning_effort="low"),
    checkpointer=InMemorySaver(),
)
config = {"configurable": {"thread_id": "game-1"}}

agent.invoke({"messages": [{"role": "user", "content": "e4"}]}, config)   # a chat move
agent.invoke({"position": {"moves": ["e2e4", "c7c5"]}}, config)             # or a position
state = agent.get_state(config).values
state["plies"][-1]   # SAN, source, analysis, model, latency, middleware telemetry
state["turns"][-1]   # every call on the turn, with tokens and cost
```

One run plays at most one turn and one thread is one game. The agent always moves for the side
to move. Input is either a chat message (`go` or one move in SAN or UCI) or a `position`
(`start_fen`, UCI `moves`, optional `restrict`). A position that doesn't extend the thread's
game is rejected; takebacks and new games use a new thread. A run with no new command retries
a pending turn (after a provider error) or is a no-op.

The record lives in `start_fen`, `moves`, `plies`, `turns`, `outcome` and `error`; `messages`
are the model's working context and may be summarized. Clients should read only those keys:
the thread-state API also returns private channels.

Options worth knowing: `memory` (`none`, `full`, `summarize`), `show_legal_moves`,
`max_retries` (illegal replies before the side to move resigns, default 3), `draw_claims`
(`auto` ends the game on an actual threefold repetition or the fifty-move rule; `never` leaves
claimable draws to the caller), `forced_move`, `seed`, `system_prompt`, `context_schema`.

### Cost

No gateway response carries a cost, so every provider response inside a model call is recorded
and priced locally with [genai-prices](https://github.com/pydantic/genai-prices) (the bundled
snapshot of the pinned version; it never fetches prices). A move's cost is its turn's total:
every LLM attempt, every System 1 request (a tournament has several) and any summary call.
`turn_cost(turn["calls"])` returns `{usd, complete}`, or `None` when nothing was priced. SemIf
reports no token counts, so its calls are unpriced and a hybrid move's total is marked
incomplete.

## The middleware contract

Extensions are ordinary `AgentMiddleware` (optionally `ChessMiddleware`, which adds
`position()`, `propose()`, `narrow()`, `ply_meta()` and `turn_calls()`). Every extension is
wrapped in a write guard that hands its hooks a detached copy of the state and checks what they
return:

- `allowed_moves` may only narrow; an empty intersection is a `ChessContractError`.
- `proposal` must be an allowed move, and only one per turn. A proposer jumps from
  `before_model` to `end` and must declare `@hook_config(can_jump_to=["end"])`.
- `candidates` are soft suggestions, set by one middleware per turn.
- The game record, `messages` and core bookkeeping are core-owned.
- Your own state keys must be `PrivateStateAttr` (or at least `OmitFromInput`). No tools.
- `before_model` must be idempotent: a retry re-enters it. Freeze each decision per turn id and
  replay it as `current allowed ∩ frozen`.
- Implement sync and async variants of every hook.

## SystemOne

```python
from langchain_chess_systemone import SystemOneMiddleware

hybrid = create_chess_agent(
    model,
    middleware=[SystemOneMiddleware("semif-qwen3.5-4b", gate="margin", threshold=0.9, k=5)],
)
system_one_alone = create_chess_agent(
    None,
    middleware=[SystemOneMiddleware("semif-qwen3.5-4b", threshold=0.0, has_model=False)],
)
```

- The gate signal is the top-1 minus top-2 probability (`margin`) or the Choice `confidence`.
  SystemOne plays when `threshold < 1` and the signal reaches it. `0` always plays; `1` never
  does (a pure pruner). Otherwise it suggests the top `k` (or the smallest prefix reaching
  `top_p`).
- SemIf takes at most 16 options per Choice and 32 questions per request. More options run a
  seeded tournament: balanced heats in as few requests as possible, finalists per heat, then a
  final. Its probabilities are among finalists only, and `tournament_threshold` gates it.
- A ranking failure (after retries) with a model behind it is recorded as `skipped` and the LLM
  chooses; without one the run fails and the turn stays pending.
- Models: `semif-qwen3.5-4b` (the default in the app and CLI; use SemIf for anything
  user-facing) and `typesafe/jev-latest` (experiments only).

## Adapters

### Web app and Studio

```sh
mise run dev   # langgraph dev on :2024 (Studio) and the web UI on :5173/ui/
```

The web UI plays a game per thread (the thread id stays in the URL), with System 1 candidates,
the gate, analysis and cost per move. Settings map to the `chess` graph's context knobs.
Studio's chat view plays too: type `go` or a move. If port 2024 is taken, run
`uv run --all-packages langgraph dev --port <p>` and start the UI with
`VITE_API_URL=http://localhost:<p>`.

### UCI engine

```sh
uv run --all-packages --env-file .env lcchess uci --policy systemone
mise run uci-match   # two SemIf-only games under fastchess
```

- Options: `Model`, `ReasoningEffort`, `SystemOneModel`, `Policy`, `Threshold`, `K`, `Memory`,
  `Seed`. `Ponder` is not advertised.
- Analysis streams as `info string` lines. LLM moves take seconds, so short time controls mean
  fallback moves: this turn's System 1 top move when it ranked, else a seeded random legal
  move. The GUI's next position includes the fallback, and the agent's pending turn is
  abandoned.
- Resignation (after four illegal replies), a finished game and a rejected position answer
  `bestmove 0000` with an `info string` reason. It isn't a standard UCI resignation but a null
  move: fastchess scores it as an illegal-move loss for the engine that played it (checked with
  fastchess v1.8.2-alpha), which is the intended forfeit.
- Draws are left to the GUI (`draw_claims="never"`).

### Terminal UI

```sh
uv run --all-packages --env-file .env lcchess play --side black
```

Type moves in SAN or UCI. `ctrl+s` starts as Black, `ctrl+r` retries a failed move, `ctrl+n`
starts a new game, `ctrl+f` switches sides.

### Install the CLI without cloning

Before PyPI, only uv can install it: it resolves the unpublished sibling packages from the same
commit (pip would look for them on PyPI). The repository is private, so git needs credentials;
never put a token in the URL, because uv stores it in tool receipts.

```sh
uvx --env-file /absolute/path/to/.env \
  --from "git+ssh://git@github.com/darieldatoon/jev-chess#subdirectory=libs/cli" lcchess play
uv tool install "git+ssh://git@github.com/darieldatoon/jev-chess#subdirectory=libs/cli"
```

## Environment

Two LangSmith orgs: traces go to one, every model call goes through the other's LLM Gateway.
Copy `.env.example` to `.env` and fill it in; `LC_GATEWAY_KEY` in your shell supplies the
gateway key. Commands that make model calls load it explicitly (`uv run --env-file .env ...`);
`langgraph dev` reads it through `langgraph.json`. The app refuses to start unless
`LANGSMITH_GATEWAY` is true, the gateway key is set, and `TYPESAFE_BASE_URL` is the gateway root.

## Development

```sh
mise trust && mise install && mise run setup   # tools, dependencies, git hooks
mise run check   # ruff, ty, and the web lint and type checks
mise run test    # pytest and Vitest, both at 100% line and branch coverage
uv run --all-packages --env-file .env pytest -m live --no-cov -q   # against the real gateway
mise run build   # the web UI into apps/server/.../static, served at /ui
```

mise provides every tool (node, pnpm, uv, lefthook, `sfw`, fastchess); Python comes from uv.
Add dependencies with `sfw uv add --package <distribution> <dependency>` (root dev tools:
`sfw uv add --group dev <tool>`) and `sfw pnpm add <pkg>` in `apps/web`. Pushing to `main`
checks, builds and deploys `jev-chess-app` (`.github/workflows/deploy.yml`).

The image builds from the uv workspace and its lockfile (`langgraph.json` `source.kind = "uv"`).
langgraph-cli 0.4.31 copies only the root `pyproject.toml` before `uv export`, so
`dockerfile_lines` adds each member's `pyproject.toml`; keep that list in step with the
workspace members. Workspace sources live only in the root `pyproject.toml`: each member is
installed on its own in the image, and a member-level `workspace = true` source fails there.
Check a build locally with `uv run --all-packages langgraph build -t langchain-chess:smoke`.

## Decisions and measurements

- **Prompt caching (Anthropic): shipped without.** The gateway's Responses route (which the
  `langsmith:` provider uses) supports only one request-level breakpoint, and it lands on the
  per-turn position, so it never hits. Caching would need `ChatAnthropic` on the gateway's
  native `/anthropic` route plus a breakpoint before the position. Measured prompts are small:
  about 520 input tokens per move with `memory="none"` (the default), most of it the per-turn
  position, so the cacheable prefix is under Opus 5's 512-token minimum; about 1,000 (at most
  1,850) with `full` over 12-ply games. At $5 per million input tokens, caching would save under half a
  cent a move. Revisit if long `full` or `summarize` games become the norm. OpenAI models cache
  automatically.
- **Memory and analysis length.** Three self-play hybrid games per mode (12 plies, low effort,
  2026-09-25): the LLM's analysis averaged 97 characters with `memory="none"` and 213 with
  `full`, so seeing earlier bare `MOVE:` turns didn't make it terser. System 1 played no moves in
  the `full` games of that sample, so the imitation risk from System 1's bare turns is still
  unmeasured.
