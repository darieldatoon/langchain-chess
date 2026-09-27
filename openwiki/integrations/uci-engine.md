---
type: integration adapter
title: UCI engine adapter (lcchess uci)
description: How `lcchess uci` wraps a langchain-chess agent as an in-process UCI engine — the one-search state machine that prints exactly one bestmove per go, time-control deadlines, fallback moves (System 1 top move else seeded random), abandoned pending turns, bestmove 0000 forfeits, UCI options including Config files, draw_claims "never", and the fastchess smoke test.
tags: [uci, cli, engine, fastchess, fallback, time-control, integration]
verified:
  - by: openwiki/0.6.0
    at: 2026-09-27T19:08:28.877Z
sources:
  - id: openwiki-source-fc393bc7c06df7c3f85ece92
    resource: repo://libs/chess/langchain_chess/middleware/core.py
  - id: openwiki-source-abe54986bd51a87223916132
    resource: repo://libs/cli/langchain_chess_cli/main.py
  - id: openwiki-source-595fa5f62bc6bdbfd212eed8
    resource: repo://libs/cli/langchain_chess_cli/options.py
  - id: openwiki-source-0dfc72fee41a53f3921fd48c
    resource: repo://libs/cli/langchain_chess_cli/uci/clock.py
  - id: openwiki-source-20ebabb38d27c2e3522a9062
    resource: repo://libs/cli/langchain_chess_cli/uci/completion.py
  - id: openwiki-source-1dd02340acf0ca7c8c33f18b
    resource: repo://libs/cli/langchain_chess_cli/uci/engine.py
  - id: openwiki-source-75f1e442bb6ed78ddb1df39d
    resource: repo://libs/cli/README.md
  - id: openwiki-source-58151a017639a9e1e28df5d3
    resource: repo://libs/cli/tests/test_uci_engine.py
  - id: openwiki-source-d16be866f79937160284e23a
    resource: repo://libs/cli/tests/test_uci_protocol.py
  - id: openwiki-source-c228b1f5ddeb31cb2374ed59
    resource: repo://libs/systemone/langchain_chess_systemone/agent.py
  - id: openwiki-source-3c3f476720af9ceef23b678d
    resource: repo://libs/systemone/langchain_chess_systemone/middleware.py
  - id: openwiki-source-72b5d686f860ea86c8592080
    resource: repo://mise.toml
generated: { by: "openwiki/0.6.0", at: "2026-09-27T19:08:28.877Z" }
---

# UCI engine adapter (`lcchess uci`)

`lcchess uci` lets a chess GUI or match runner (fastchess, Cute Chess, and so on) play a langchain-chess agent as if it were an ordinary UCI engine. It is an **in-process adapter**. The agent graph is built directly in the CLI process with an `InMemorySaver` checkpointer. The adapter turns UCI commands on stdin into agent runs and turns agent state back into `info string` / `bestmove` lines on stdout. There is no server in between.

The code lives in `libs/cli/langchain_chess_cli/uci/`:

| Module | Role |
| --- | --- |
| `protocol.py` | Pure parser. One line in, one typed command out (`Uci`, `IsReady`, `SetOption`, `UciNewGame`, `Position`, `Go`, `Stop`, `PonderHit`, `Quit`, `Unknown`). |
| `clock.py` | Pure deadline calculation from `go` parameters. |
| `completion.py` | Pure mapping from final agent state plus the search's run status to `info string` lines and exactly one `bestmove`. |
| `engine.py` | The stateful `Engine`: search state machine, UCI options, threads, stdin loop (`run`). |

Related pages: the per-turn lifecycle the adapter relies on (pending, committed, abandoned, terminal turns) is covered in [Turn lifecycle](/openwiki/architecture/turn-lifecycle.md). The settings model (`ChessContext`), settings files and flags are covered in [Settings and model arguments](/openwiki/concepts/settings-and-model-arguments.md). The source of the fallback move is covered in [System 1](/openwiki/architecture/system-one.md). The other CLI adapter is the [Terminal UI](/openwiki/integrations/terminal-ui.md).

## Entry point and wiring

The `uci` Typer command in `libs/cli/langchain_chess_cli/main.py` builds a `ChessContext` (the shared opponent settings from `langchain_chess_systemone.settings`). It starts from `--config <file>` (a JSON settings file) or the defaults, resets any `--reset <setting>` names to their defaults, and then overlays the flags that were given (`overlay` in `libs/cli/langchain_chess_cli/options.py`). A flag left out keeps the setting's value. The flags mirror the settings: `--policy`, `--model`, `--reasoning-effort`, `--systemone-model`, `--threshold`, `--tournament-threshold`, `--k`, `--top-p`, `--gate`, `--style`, `--seed`, `--move-list`, `--with-eval`, `--with-nouls`, `--memory/--no-memory` (a boolean), `--system-prompt`, `--show-fen`, `--show-board` and `--model-kwargs <JSON>`. Unlike `play`, `uci` has **no `--draw-claims` flag**. The command then:

- sends logging to **stderr** at WARNING, so stdout carries only protocol output;
- defines a factory `(ChessContext, Checkpointer) -> CompiledStateGraph` that calls `build_agent(settings, checkpointer=...)`. The engine calls it again whenever settings change, and it always passes the same checkpointer;
- defines `out`, which writes one line to stdout and flushes it;
- constructs `Engine(factory, settings, out=out)` (a `ValueError`, such as an out-of-range seed, becomes a Typer `BadParameter`) and runs `asyncio.run(run(engine))`.

`run()` reads stdin lines through `loop.run_in_executor(None, stdin.readline)` so the event loop keeps running searches and timers while it waits for input. It stops after `quit`. At end of input it handles an implicit `quit`, which settles any active search, and then stops.

Every agent run uses `run_config("uci", thread, settings)`. The trace is named `chess-uci`, tagged `uci`, and its metadata holds `surface: "uci"` plus every setting (`dump(settings)`, which includes `draw_claims`) and the values actually sent where `model_kwargs` changed them (`sent(settings)`), in the same shape as server traces.

### Settings the engine enforces (`_for_uci`)

Every settings value the engine accepts, at construction or from an option, passes through `_for_uci`:

- `draw_claims` is forced to `"never"` (`DRAW_CLAIMS`), whatever the flags, config file or settings say. See [Draws](#draws-draw_claims--never).
- `seed` must be within `0..2147483647`, the range of the `Seed` spin. A larger launch seed fails the command. A config file with an out-of-range seed is reported as `options not applied: ...` and changes nothing.

## Protocol parsing

`parse()` is intentionally forgiving:

- Bare keywords (`uci`, `isready`, `ucinewgame`, `stop`, `ponderhit`, `quit`) must appear with no extra tokens. `uci extra` becomes `Unknown`.
- `setoption name <multi word name> [value <multi word value>]`. A missing `value` gives `value=None`, which the engine converts from the empty string.
- `position startpos|fen <FEN...> [moves ...]`. The FEN is not checked here. Invalid FENs are rejected later by the agent.
- `go` reads `movetime`, `wtime`, `btime`, `winc`, `binc`, `movestogo`, the flags `infinite` and `ponder`, and `searchmoves ...`. The `searchmoves` list runs until the next go keyword. `depth`, `nodes` and `mate` are recognised so their arguments get skipped, but they have no effect. Non-integer values are dropped.

Unknown non-blank lines produce `info string unknown command: ...`. Blank lines are ignored.

## The search state machine

The engine is `idle → searching → idle`, with **at most one `Search` at a time**. Each search has an increasing id, a fixed root `Position`, its `Go`, a request fingerprint, a fallback pool, and a `held` flag. It owns two asyncio tasks: `task` streams the agent run, and `runner` supervises it. It may also own a deadline `timer`.

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Searching: go
    Searching --> Settled: task ends and not held
    Searching --> Settled: deadline cancels task
    Searching --> Held: task ends while held
    Held --> Settled: stop or ponderhit
    Searching --> Settled: stop, go, ucinewgame, quit
    Settled --> Idle: bestmove printed, queued options applied
```

*The engine's search lifecycle. Every path to Settled goes through `_settle`, which prints exactly one bestmove.*

### Starting a search (`go`)

1. **Retire the previous search first.** `go`, `ucinewgame` and `quit` all call `_retire()`. It cancels the old task, waits for its supervisor, and settles it, so the old search prints its `bestmove` before anything new starts.
2. Apply queued options (see below).
3. **Pick the thread.** `_thread_extends` reads the current thread's checkpointed `moves` and `start_fen`. The thread is kept only if the new position has the same root (FENs normalised through python-chess) and its move list starts with the moves already recorded. Otherwise, for example after a takeback, a different root, or a new game without `ucinewgame`, the engine starts a fresh `uci-<uuid>` thread. `ucinewgame` always starts a fresh thread. Because of this, the model sees only the new moves on a continuing game: "one thread, one game." Replacing a thread deletes the old one from the checkpointer (`adelete_thread`), which is safe because no search is outstanding at that point, so the checkpointer holds only the current game.
4. **searchmoves.** Illegal entries are dropped and reported with `info string ignoring illegal searchmoves: ...`. The engine never widens the search: if every entry was illegal, it still sends an empty `restrict`, and the agent rejects it (`restrict must not be empty` → `bestmove 0000`).
5. Build the agent input `{"position": {"start_fen", "moves", ["restrict"]}}`. Compute `request = fingerprint(start_fen, moves, restrict)`, the same fingerprint the core middleware uses as the turn's `request`. Compute the pool from `root_moves(...)`: the legal root moves within the restriction, which are the only moves a fallback may play.
6. Start `_think` (the agent stream) and `_supervise`, and arm the deadline. `held = go.infinite or go.ponder`.

### Streaming analysis

`_think` streams `astream(..., stream_mode="messages")` and keeps only chunks from the `model` node. It buffers text and emits one `info string <line>` per completed non-blank line. Once the search has settled it stops emitting, so a late stream cannot interleave with the next search's output. All `info string` output goes through `info_lines`, which splits text into one prefixed line per non-blank line, so a multi-line model reply or error message cannot forge a command such as `bestmove` on stdout.

### Deadlines (`clock.py`)

`deadline_ms(go, white_to_move)` returns:

- `None` (no deadline) for `infinite`, `ponder`, or a `go` with neither `movetime` nor the side's clock (depth/nodes-only);
- `max(50, movetime − 150)` for `movetime`;
- otherwise `max(50, min(remaining / (movestogo or 30) + increment, remaining) − 150)`, using `wtime/winc` or `btime/binc` for the side to move. The side to move comes from the start FEN's turn and the parity of the move list.

`SAFETY_MS = 150` is kept back so the engine can settle and print `bestmove` before the GUI's flag falls. When the deadline fires, `_expire` cancels the stream task. The supervisor records status `cancelled` and settles. Any other exception becomes status `failed` with the error message ("every failure still owes a bestmove").

### Holding: `go infinite`, `go ponder`, `stop`, `ponderhit`

With `held` set, the supervisor records completion (`done`) but does not settle. The result waits:

- `stop` calls `_release`: clear `held`, cancel the task (no effect if it already finished), wait for the supervisor, then settle.
- `ponderhit` on a held search turns it into a normal search: `ponder` and `infinite` are cleared. If the run already finished, the engine settles at once. Otherwise it arms a deadline from the ponder `go`'s clock values.
- `stop` or `ponderhit` with no active search, or a second one after settling, does nothing. The `Ponder` option is **not** advertised.

### Settling: one completion per `go`

`_settle` runs under a lock and does nothing if the search is already `settled`. This check is what guarantees exactly one `bestmove` per `go`, even when the timer, supervisor, `stop` and a new `go` race. It reads the thread's checkpointed state, builds a `SearchResult(request, status, error, pool, seed=f"{seed}:{request}")`, prints the lines from `complete()`, clears the active search, and applies queued options.

## From agent state to `bestmove` (`completion.py`)

`complete()` checks these rows in order. A turn counts as "ours" only when the latest turn's `request` equals this search's fingerprint, so state left over from an older request never decides the answer.

```mermaid
flowchart TD
    S["latest turn is ours?"] -->|"committed"| C["bestmove = committed ply"]
    S -->|"terminal + resignation"| R["info resigns + bestmove 0000"]
    S -->|"terminal + other outcome"| G["info game over + bestmove 0000"]
    S -->|"otherwise"| J{"finished and invocation is reject?"}
    J -->|"yes"| X["info error text + bestmove 0000"]
    J -->|"no"| F["fallback, with info error if failed"]
    F --> K{"ours and fallback_move in pool?"}
    K -->|"yes"| K1["play it"]
    K -->|"no, pool empty"| K2["bestmove 0000"]
    K -->|"no"| K3["seeded random pick from pool"]
```

*How `complete()` chooses the single bestmove for a search.*

- **Committed.** A committed ply wins even if the search was cancelled. The move landed before the cancellation took effect.
- **Resignation.** After repeated illegal replies (four in the tests), the output is `info string resigns: no legal move after N attempts` and then `bestmove 0000`.
- **Game already over** (checkmate, stalemate, insufficient material, and so on): `info string game over: <result text>` and then `bestmove 0000`.
- **Rejected position** (invalid FEN, illegal moves, empty restriction): `info string <agent error>` and then `bestmove 0000`.
- **Fallback** after a cancellation, a deadline or an execution failure. A failure also prints `info string error: <message>`. The first choice is the state's private `fallback_move` field, used only when the latest turn is ours and the move is in the pool. System 1 writes that field with its top-ranked move for the turn when it ranked (`libs/systemone/langchain_chess_systemone/middleware.py`). Without one, the engine picks with `random.Random(f"{seed}:{request}")` from the pool, so the choice is reproducible for a given `Seed` and position. An empty pool (the position doesn't replay) gives `0000`.

### Why `0000`

`NULL_MOVE = "0000"` is a null move, not a standard UCI resignation. GUIs score it as a forfeit, and that is the intent. The README notes that fastchess (pinned at `v1.8.2-alpha` in `mise.toml`) scores it as an illegal-move loss for the engine that played it.

### Abandoned pending turns

A fallback is decided by the adapter, not the agent, so the agent's turn stays `pending` in the checkpoint. The GUI's next `position ... moves` includes the fallback move. The thread still extends (the old moves are a prefix), so the core middleware's lifecycle sees a new request while a turn is pending. It marks that turn `abandoned`, syncs the fallback in as an **external** ply, and opens a new turn (`libs/chess/langchain_chess/middleware/core.py`). `test_stop_before_commit_then_the_fallback_enters_as_an_external_move` checks exactly this: turn statuses `["abandoned", "committed"]`, and ply 1 has `source == "external"`.

## Options

`uci` prints `id name langchain-chess`, `id author ...`, the option declarations, then `uciok`. Option names are case-insensitive (keyed by lowercase name). Declared defaults come from the launch settings.

| UCI option | Type | Values | `ChessContext` field |
| --- | --- | --- | --- |
| `Config` | string | path to a settings file, or `<empty>` | replaces all settings |
| `Model` | string | any non-blank model spec | `model` |
| `ReasoningEffort` | combo | `default` / `low` / `medium` / `high` (`default` sends no effort, i.e. `None`) | `reasoning_effort` |
| `SystemOneModel` | string | e.g. `semif-qwen3.5-4b` | `systemone_model` |
| `Policy` | combo | `llm` / `systemone` / `hybrid` | `policy` |
| `Threshold` | string | float in 0..1 | `threshold` |
| `K` | spin | 1..255 | `k` |
| `Memory` | check | `true` / `false` (case-insensitive; the legacy values `summarize` / `none` map to true / false) | `memory` |
| `MoveList` | combo | `both` / `legal` / `candidates` / `none` | `move_list` |
| `Seed` | spin | 0..2147483647 | `seed` |

Other settings (`gate`, `style`, `top_p`, `tournament_threshold`, `with_eval`, `with_nouls`, `system_prompt`, `show_fen`, `show_board`, `model_kwargs`) have no individual option. They can be set with command-line flags or through a `Config` file.

**Config.** `setoption name Config value <path>` loads a settings file and **replaces every setting** with it (still passed through `_for_uci`, so draws stay `never`). Options set afterwards patch the loaded settings. A relative path is resolved from the engine's working directory, which the GUI chooses. An empty value or `<empty>` (which GUIs often send at startup) restores the settings the engine **started with**, not the library defaults. A file that can't be read or validated is reported as `invalid value for Config: ...` and changes nothing.

**Validation.** Unknown names produce `info string unknown option: <name>`. Invalid values produce `info string invalid value for <name>: <reason>` and are dropped.

**Rebuild semantics.** Valid values go into a queue. When idle, the queue is applied at once. During a search, options stay queued so the running search is not disturbed. They are applied after the search settles, at the next `go`, or at `isready` once idle. `isready` always answers `readyok` right away, even mid-search. Queued values are applied **one at a time, in order**: each builds new settings (the current settings with that field changed, or the loaded config), validates them, and calls the factory with the **same** checkpointer, so thread history survives. Settings and agent change together or not at all. If validation or the factory raises (for example `build_agent` refusing `Memory` for a model with no known input limit), the engine prints `info string options not applied: <error>` and keeps the previous settings and agent for that entry, then continues with the rest of the queue, so a failing option costs only itself.

## Draws: `draw_claims = "never"`

The engine forces `draw_claims = "never"` onto every settings value it builds agents from, and so onto their trace metadata ("The GUI adjudicates draws: a claimed one would end the game as `bestmove 0000`"). The agent does not claim threefold repetition or fifty-move draws itself. The GUI or match runner adjudicates them. Draws that happen automatically on the board (for example insufficient material) still end the game in the agent and produce `game over` + `0000`.

## Operations

```sh
mise run dev:uci -- --policy systemone   # uv run --all-packages --env-file .env lcchess uci ...
mise run test:uci                        # fastchess smoke match
```

LLM moves take seconds, so short time controls mostly produce fallback moves. `Policy systemone` is the practical choice for fast games.

### fastchess smoke test (`mise run test:uci`)

The `test:uci` task in `mise.toml` runs inside `.uci-match/`, which is gitignored, because fastchess writes `config.json` to the working directory. It plays two SemIf-only engines against each other, `lcchess uci --policy systemone --seed 1` against `--seed 2`, with `st=3` (3 s per move), `timemargin=2000`, 1 round of 2 games, and a 60-move cap. It writes `games.pgn` and `fastchess.log`. It passes only if both games have a real `Result` (`1-0`, `0-1`, `1/2-1/2`) and no `Termination` tag other than `normal` or `adjudication`, meaning no forfeits from time losses or `0000`. fastchess is pinned in `mise.toml` (`v1.8.2-alpha`).

## Tests

- `libs/cli/tests/test_uci_protocol.py` covers the pure layers: the parse table, deadline arithmetic (safety margin, `MIN_MS` floor, `movestogo`, missing side clock), `root_moves`, and every `complete()` row, including stale-request and out-of-pool fallbacks.
- `libs/cli/tests/test_uci_engine.py` drives `Engine` with a `ScriptedModel`. It covers the handshake and option declarations, draws never being claimed whatever the settings say, streamed analysis, game continuation on one thread, takebacks, new roots and invalid FENs starting new threads, deadline fallbacks, provider failures, resignation, insufficient material, searchmoves, the `go infinite` / `stop` / `ponderhit` holding rules, one `bestmove` per `go` when `go` or `ucinewgame` interrupts a search, late results being ignored, option queueing and rebuild counts, failed rebuilds leaving settings untouched, `ReasoningEffort default` mapping to `None`, `Config` loading / `<empty>` restore / failure / queueing during a search, a failing queued option costing only itself, the seed range check, retired threads being deleted from the checkpointer, multi-line errors that cannot forge commands, and `run()` stopping at `quit` or end of input.
- `libs/cli/tests/test_options.py` covers settings overlay and `run_config` trace naming and metadata.
