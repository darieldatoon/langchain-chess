---
type: workflow
title: Grading and review
description: How `lcchess grade` selects game threads from LangSmith, rebuilds each game from its root runs, evaluates every distinct position once on a pool of UCI engines, grades moves the Lichess way, and writes fingerprinted feedback; how the review app replays it and launches grading jobs in a LangSmith sandbox built from the grader snapshot.
tags: [grading, lcchess, langsmith, feedback, stockfish, review-app, accuracy, sandbox]
verified:
  - by: openwiki/0.6.0
    at: 2026-09-27T19:08:28.877Z
sources:
  - id: openwiki-source-1367020fc794d7846ab57adc
    resource: repo://.github/workflows/deploy-grader.yml
  - id: openwiki-source-9405064bfb21c826d2495b26
    resource: repo://apps/review/src/analysis.ts
  - id: openwiki-source-e38522714f61b06be12390be
    resource: repo://apps/review/src/api.ts
  - id: openwiki-source-c29d1556d6d26b04617e532d
    resource: repo://apps/review/src/App.tsx
  - id: openwiki-source-bdf6fdb9290364f6d610e7d9
    resource: repo://apps/review/src/components/AnalysisBanner.tsx
  - id: openwiki-source-8e17609d88ef23327924a49d
    resource: repo://apps/review/src/components/GameView.tsx
  - id: openwiki-source-ed1fb758d91e09f3b631921d
    resource: repo://apps/review/src/components/GradeCard.tsx
  - id: openwiki-source-471a9092cd5b3971e06785cb
    resource: repo://apps/review/src/games.ts
  - id: openwiki-source-4a50211e51ae5b4042cd6e74
    resource: repo://apps/review/src/review.ts
  - id: openwiki-source-f93334adeeacab16f8dc8d99
    resource: repo://apps/review/src/values.ts
  - id: openwiki-source-500a1f2f2d50bab24bed66be
    resource: repo://docker/grader.Dockerfile
  - id: openwiki-source-5b6b489082764cbfaca4adbf
    resource: repo://libs/chess/langchain_chess/engine.py
  - id: openwiki-source-347e47f606324c25df1bf7de
    resource: repo://libs/chess/langchain_chess/grading.py
  - id: openwiki-source-5cb9a92cfa0c294e20b8d861
    resource: repo://libs/cli/langchain_chess_cli/grade/batch.py
  - id: openwiki-source-c94d78e660f0193e2676acf8
    resource: repo://libs/cli/langchain_chess_cli/grade/cli.py
  - id: openwiki-source-615f8b635b92b34cc695c7f3
    resource: repo://libs/cli/langchain_chess_cli/grade/job.py
  - id: openwiki-source-82a6e5c6ffb40da504aee7a9
    resource: repo://libs/cli/langchain_chess_cli/grade/records.py
  - id: openwiki-source-d969264c61f38dc1524a52c7
    resource: repo://libs/cli/langchain_chess_cli/grade/store.py
  - id: openwiki-source-abe54986bd51a87223916132
    resource: repo://libs/cli/langchain_chess_cli/main.py
  - id: openwiki-source-86c764f8d1bcb50d2d33c301
    resource: repo://libs/cli/tests/test_grade.py
  - id: openwiki-source-72b5d686f860ea86c8592080
    resource: repo://mise.toml
  - id: openwiki-source-27a918e9e11693d5de03d421
    resource: repo://scripts/grader-snapshot.py
generated: { by: "openwiki/0.6.0", at: "2026-09-27T19:08:28.877Z" }
---

# Grading and review

`lcchess grade` runs after games have been played. It reads the games back from their LangSmith traces, has a UCI engine (Stockfish by default) evaluate every position, classifies each move and computes accuracy the way Lichess does, then writes the results back to the same traces as feedback. The review app is a LangSmith sandbox app. It lists the games in a project and replays each one on a board, using the single `game_review` feedback value that the grader writes. Its **Analyze** button can also run `lcchess grade` for one game inside a LangSmith sandbox started from a prebuilt "grader snapshot" image.

The code is split into layers:

| Layer | Where | Role |
| --- | --- | --- |
| Command | `libs/cli/langchain_chess_cli/main.py` (`grade`), `grade/cli.py` | Parses and validates options, builds the `EngineConfig`, prints progress |
| Batch | `grade/batch.py` (`grade_batch`) | Selects games, skips games already graded, schedules positions, writes each game |
| Sandbox job | `grade/job.py` (`sandbox_job`) | With `--sandbox-job`: settles the review app's `grade_status` marks, then deletes its own sandbox |
| Records | `grade/records.py` | Pure code. Turns root runs into a `GameRecord` and a grade into `Feedback` entries |
| Store | `grade/store.py` (`LangSmithStore`) | The LangSmith side: finds threads, reads runs, reads grading marks, replaces feedback, settles `grade_status` marks |
| Engine | `libs/chess/langchain_chess/engine.py` | `EngineConfig`, `Grader` fingerprint, `EnginePool` of UCI processes |
| Grading math | `libs/chess/langchain_chess/grading.py` | Pure code. Positions, judgements, cp/win% loss, move and game accuracy |
| Review app | `apps/review/src` | Reads threads, last runs, `game_review` and `grade_status` feedback, replays the graded game, launches Analyze jobs (`analysis.ts`) |
| Grader image | `docker/grader.Dockerfile`, `scripts/grader-snapshot.py`, `.github/workflows/deploy-grader.yml` | Builds the `langchain-chess-grader` sandbox snapshot (Stockfish + `lcchess`) |

For the shape of the run outputs the grader reads (`start_fen`, `moves`, `plies`, `outcome`), see [the state record](/openwiki/concepts/state-record.md). For how the review app is built and hosted, see [web frontends](/openwiki/architecture/web-frontends.md) and [deployment](/openwiki/operations/deployment.md).

## End-to-end sequence

```mermaid
sequenceDiagram
    participant User
    participant Cmd as lcchess grade
    participant Batch as grade_batch
    participant Store as LangSmithStore
    participant Pool as EnginePool
    participant Math as grading.py
    User->>Cmd: options
    Cmd->>Batch: Selection, store, pools, workers
    alt project query
        Batch->>Store: find_threads
    end
    Batch->>Store: thread_runs per thread
    Batch->>Batch: game_record per thread
    Batch->>Pool: open probe pool of 1
    Pool-->>Batch: Grader and fingerprint
    opt not forced
        Batch->>Store: graded on last run
        Store-->>Batch: stored fingerprint or none
    end
    Batch->>Math: engine_fens over all games
    Batch-->>User: Planned event
    Batch->>Pool: open pool of N engines
    loop each distinct unsettled FEN
        Batch->>Pool: analyse FEN
        Pool-->>Batch: Analysis lines
    end
    loop each game once its positions are done
        Batch->>Math: grade_game
        Batch->>Batch: feedback entries
        Batch->>Store: replace old feedback
        Store->>Store: delete ours, write rest, write game_review, clear grade_status
        Batch-->>User: Graded event
    end
```

*The grading pipeline, from option parsing to feedback writes. With `--dry-run` it stops after the Planned event.*

## 1. Choosing threads

`cli.selection` turns the options into one of two kinds of `Selection`:

- **Explicit threads** (`--thread`, repeatable, and/or `--threads-file` with one id per line; blank lines and `#` comments are skipped) become a `Threads(project, ids)` selection. Duplicates are dropped, keeping first-seen order. `--since`, `--until`, `--limit` and `--metadata` cannot be combined with explicit threads; doing so is a usage error.
- **Project query**: with no thread ids, a `ProjectQuery` is built. `LangSmithStore.find_threads` lists root runs in the project, newest first. It passes `--since` as `start_time` and builds a filter from `--until` (`lt(start_time, ...)`) and each `--metadata key=value` pair (`eq(metadata_key)`/`eq(metadata_value)`, joined with `and(...)`). It collects distinct `metadata.thread_id` values and stops once it has `--limit` threads. A naive `--since`/`--until` is read as local time.

You always need a project, either `--project` or `LANGSMITH_PROJECT`. Option errors (`OptionError`) are raised as Typer `BadParameter`, so the command exits with code 2. `--sandbox-job` is only accepted together with explicit `--thread` ids; with a project query it is also an option error.

## 2. Rebuilding a game from its root runs

For each thread, `thread_runs` fetches every root run whose metadata `thread_id` matches, selecting `id`, `session_id`, `start_time` and `outputs`. Up to 8 threads are fetched at once. `records.game_record` then builds a `GameRecord`:

- Only runs whose outputs contain a `plies` list count. Errored runs and non-chess runs are ignored, and the order the runs arrive in doesn't matter. If no run qualifies, or the best run has no plies, the thread is reported as `Skipped(reason="no_game")`.
- The **last run** is the run with the most plies, with ties going to the latest `start_time`. Its outputs supply `start_fen`, `moves` and `outcome`.
- `turn_ids` come from each ply's `turn_id`. It is `None` for moves that arrived as input (for example a human's move in the web UI), not played by the agent.
- `ply_runs` uses `grading.first_runs` to map each ply to the first run, in start order, whose record contains it. That is the run that played the move or received it.
- `positions` (`grading.positions`) replays the moves to list every FEN, the start position included. Only the final position can be **settled** without an engine: checkmate becomes `Mate(0, winner)`, and a draw outcome or a board-level game end becomes `Cp(0)`. A claimed draw is settled even when an engine could still score the position.

## 3. Engine setup, fingerprint and the skip check

`EngineConfig` holds the engine binary (`--engine`/`STOCKFISH_PATH`, default `stockfish`), a single search limit, `--multipv` (default 1), `--engine-threads` (default 1) and `--hash` MB (default 256). The search limit is one of `--depth`, `--nodes` or `--movetime` in ms; giving more than one is an error, and the default is depth 16.

Before it checks for games already graded, the batch opens a **probe pool of one engine** to learn the `Grader`: the engine's UCI `id name` plus `EngineConfig.settings()`. The settings are the limit kind and value, multipv, threads and hash_mb. The binary path is deliberately left out because it differs between machines. `Grader.fingerprint` is the first 16 hex characters of a SHA-256 over the sorted JSON of the engine name and settings. A different engine version or a different setting therefore produces a different fingerprint.

Unless `--force` is set, `LangSmithStore.graded(last_run.id)` looks for `game_review` feedback on the game's last run and returns the fingerprint from it. It only counts feedback whose source metadata has `grader == "lcchess grade"`. If that fingerprint equals the current grader's, the game is skipped with `Skipped(reason="graded")`. As a result:

- Re-running with the same engine and settings is cheap and idempotent.
- Changing a setting or upgrading the engine re-grades everything.
- A game that has continued since it was graded now has a new last run with no mark, so it is graded again.
- `--force` re-grades regardless.

## 4. Evaluating each distinct position once

`grading.engine_fens` collects the unsettled FENs of every remaining game, deduplicated, in first-seen order. The work unit is a position, not a game, so games that share an opening only evaluate it once and one long game cannot hold up the batch. The `Planned` event reports the games, the position count and the pool size. With `--dry-run` the batch stops here and writes nothing, though the probe engine has already been started.

The pool size is `max(1, min(workers, len(fens)))`. `--workers` defaults to `os.cpu_count() // engine_threads` (at least 1). `EnginePool` starts that many `popen_uci` processes and configures `Threads` and `Hash` on each. If any process fails to start, the ones already running are shut down. Shutdown is bounded: each engine gets `quit_timeout` seconds (default 5) to answer `quit`, after which its process is killed. Engine errors and timeouts during shutdown are suppressed, and if the exit is cancelled the pool still waits for the cleanup to finish before re-raising, so no engine process is left orphaned. `analyse` takes whichever engine is idle from a FIFO queue. Because the batch creates one task per FEN, game by game, positions from earlier games are searched first, so those games finish and are written first.

Two details keep grades reproducible:

- Each `analyse` call passes a fresh `game` object, so python-chess sends `ucinewgame` and clears the hash. Without this, a grade would depend on which positions that engine happened to search before.
- More than one engine thread makes the search nondeterministic. `--nodes` gives the same grades on any machine; `--movetime` does not.

`analysis_from` turns the engine info into `Line`s, each an eval from White's side plus a UCI PV, best first. It raises `EngineError` if the engine returned no score. Mate scores become `Mate(moves, winner)`.

## 5. Classification and accuracy (Lichess-compatible)

`grade_game(positions, moves, analyses)` is pure. The constants come from scalachess `eval.scala`, lila `Advice.scala` and lila `AccuracyPercent.scala`. For each ply:

- **Evals**: each position uses its settled eval, or else the engine's top line. Centipawns are clamped to ±1000 (`CP_CEILING`), and any mate counts as ±1000 from the mover's point of view.
- **Winning chances**: `2 / (1 + exp(-0.00368208 * cp)) - 1`, in [-1, 1]. Win% is `50 + 50 * chances`.
- **Quality**: a move is `best` when it equals the engine's best move. Otherwise `judge` decides:
  - Between centipawn evals, a drop in winning chances of ≥0.3 is a `blunder`, ≥0.2 a `mistake`, and ≥0.1 an `inaccuracy`.
  - Walking into a forced mate is graded by how good the position was before (`_by_cp`: >999 is an inaccuracy, >700 a mistake, anything else a blunder).
  - Losing your own forced mate is graded by the centipawn eval after the move, and counts as 0 if the opponent now has the mate.
  - Other mate-to-mate transitions get no judgement.
  - Anything left over is `good`.
- **`cp_loss`**: `max(0, cp_before - cp_after)` from the mover's side, using clamped values. **`win_pct_loss`**: `max(0, win%_before - win%_after)`.
- **Move accuracy**: 100 if win% did not drop. Otherwise `103.1668 * exp(-0.04354 * drop) - 3.1669 + 1`, clamped to [0, 100]; the `+1` is lila's uncertainty bonus.
- **Game accuracy** per side (`game_accuracy`): win% windows of size `clamp(len(moves) // 10, 2, 8)`, with each window's weight being its standard deviation clamped to [0.5, 12]. A side's accuracy is the mean of its volatility-weighted mean accuracy and its harmonic mean accuracy. A side that never moved gets `None`. The side to move first comes from the start FEN, so games that start with Black to move are handled.

## 6. Writing feedback

`records.feedback` places each entry on a specific run:

- **Per-move keys** (`move_quality`, `cp_loss`, `win_pct_loss` rounded to 2 decimals, `best_move`) are written only for **agent turns**, meaning plies with a `turn_id`. They go on the root run that played that ply, and their `source_info` includes `ply`.
- **Game keys** go on the game's last run: `accuracy_white`/`accuracy_black` (rounded to 1 decimal; omitted for a side that never moved), then `game_review`, which is always the **last** entry.
- Every entry's `source_info` carries `grader: "lcchess grade"`, `engine`, `settings` and `fingerprint`. The store uses these fields to recognise its own feedback.

The `game_review` value (`version: 1`) holds everything the review app draws in a single value: engine, settings, per-side accuracy, one eval per position (`{"cp": n}` or `{"mate": n, "winner": side}`), and a per-ply list with `run_id`, `side`, `uci`, `best_move`, `quality`, `cp_loss`, `win_pct_loss`, `accuracy` and the engine `lines` for the position before the move. Because each ply carries its `run_id`, the app does not need to read every turn's run.

`LangSmithStore.replace(runs, entries)` implements the "replace" semantics:

1. It lists feedback for any grading key (`KEYS`) and for `grade_status` on **all** of the game's runs, keeping only entries whose source metadata says `grader == "lcchess grade"`. Feedback from people or other graders under the same keys is kept.
2. It deletes the old `game_review` markers first, then the other old grading keys. A game reads as graded while an old marker survives, so the marker goes before anything else.
3. It writes every entry except the last, in parallel (default 16 threads). Deletes finish before any of these writes start.
4. It writes the `game_review` marker by itself, after everything else.
5. Only then does it delete this grader's `grade_status` marks (the review app's "analyzing" mark), so the game never reads as neither analyzing nor graded.

Every write passes `extend_trace_retention=True`, so a graded game's traces are kept longer. Since the marker is deleted first and written last, and the skip check only looks at the marker, a replace cut short (including a failed delete) never leaves a partly rewritten game marked graded; the next run redoes it.

## Failure behaviour and progress

`grade_batch` runs one `finish` coroutine per game. Each waits for the analyses of that game's unsettled FENs, grades the game, and calls `store.replace`. These coroutines are gathered with `return_exceptions=True`, so every game settles before any failure surfaces and no finished game's write is cut off. The remaining engine tasks are then cancelled and the first exception is re-raised. When an engine dies, games that don't depend on the failed position keep their written grades; a re-run skips them and retries the rest.

`cli.printer` prints progress to stderr:

- `skip <thread>: no game in its traces` or `... already graded with these settings (--force redoes it)`
- `nothing to grade`, or the dry-run plan (`would grade N games, P positions` plus an engine line and plies per game)
- `grading N games, P positions on W x <engine> (<settings>)`
- one `graded <thread>: ... accuracy white X black Y [done/total positions, rate/s]` line per game

After a real run it prints `done: G graded, S skipped`. `Summary.positions` counts only the positions actually evaluated.

## The sandbox job (`--sandbox-job`)

When the review app's Analyze button launches a grading job, nothing polls the sandbox afterwards, so the job must report its own result. `main.grade` with `--sandbox-job` wraps the normal batch in `job.sandbox_job`:

- It tees every progress line through the normal printer and keeps the last 20 lines (`TAIL_LINES`) as a log tail.
- When the batch finishes, `verdicts` decides each requested thread's `grade_status` mark. A graded game's mark was already cleared by `replace`. A game skipped as already graded gets `None` (clear). A game with no record gets the text `"The thread has no game in its traces."`. Any other game gets the batch's failure, or `None` if the batch succeeded.
- If the batch raises, the exception type and message are appended to the tail. Every game not yet written is failed with that log, and the exception is re-raised.
- `LangSmithStore.settle(runs, failure)` deletes this grader's `grade_status` marks on the thread's runs when `failure` is `None`, and otherwise updates them to `value="failed"` with the log as the comment. It does nothing for an empty run list, because an empty `run_ids` filter would match every mark in the workspace.
- In a `finally`, `delete_own_sandbox` deletes the sandbox named by `LANGSMITH_SANDBOX_NAME` through `langsmith.sandbox.SandboxClient`. Outside a sandbox, or if the delete fails, it only prints a message; the sandbox's idle TTL is the backstop.

## The review app

The review app (`apps/review`) runs in a LangSmith sandbox. `entry.tsx` renders `App`, calling the host's `window.langsmith.call` through `createApi`:

- **Project and window**: `defaultProject` picks `langchain-chess-app` first, then any project whose name contains "chess", then the most recent. The window options are the last 1, 7 (default), 30 or 90 days.
- **Listing games**: `api.games` pages through `POST /api/v2/threads/query`, 20 threads at a time. For each page it fetches, in parallel, the threads' last root runs (`POST /api/v2/runs/query` by `last_trace_id`, with `min_start_time` set because unbounded queries are rate-limited harder) and the `game_review` and `grade_status` feedback on those runs (`GET /api/v1/feedback`). `reviewsByRun` keeps only reviews whose source metadata has `grader == "lcchess grade"`; `marksByRun` keeps this grader's newest `grade_status` mark per run. A refresh reloads every page on screen, and keeps loading pages until the open game is among them.
- **Grading states**: `parseReview` returns `graded` only for a complete `version: 1` review whose fields all validate, whose plies are index-matched (`ply === i`), and which has exactly one eval per position (`evals.length === plies.length + 1`). Anything else is `invalid` with a reason. `toGame` also marks a review `invalid` when its plies' `uci` values differ from the game's moves. With no review the game is `ungraded`.
- **Game record**: `decodeValues` accepts a run's outputs only when `moves` is an array of UCI strings and the optional `start_fen`, `plies`, `turns` and `outcome` have the expected shape. Otherwise the game has no values and the app shows "No game record" instead of a board. `toGame` builds the matchup label from run metadata (`policy`, `model`, `systemone_model`).
- **List row**: matchup, result (`1-0`, `0-1`, `½-½`, or "In progress"), start time, ply count, and White / Black accuracy or "Not graded"; while a job is analyzing, stalled or failed, the row shows that status instead of the grade.
- **Replay** (`GameView`): the app replays FENs from `start_fen` and `moves` and steps through them with keys or controls. When a review exists it adds:
  - an eval bar from `review.evals[index]`
  - arrows for the played move and, if different, the engine's best move
  - quality badges in the move list
  - a `GradeCard` showing eval before → after, best move in SAN, winning chances lost, centipawn loss, move accuracy, and engine lines of 6 plies each. The card's height is set by the most lines any ply carries (not by the claimed `settings.multipv`), so the graph below it doesn't move
  - an `EvalGraph` over every position, where clicking a point jumps to that position
  - a **Re-analyze** button when no job is running

  "Open trace" opens the current ply's `run_id` from the review, or the thread's last run. Below the board, `AnalysisBanner` shows where the game stands (see below).
- `review.ts` keeps a TypeScript mirror of the review schema and of `win_percent` (`whiteWinPercent`, same ±1000 clamp and 0.00368208 constant), so the app's eval bar and graph agree with the grader.

The grader writes `game_review` on the run with the most plies, but the app looks for it on the thread's `last_trace_id`. The two are normally the same run, since each new turn's run carries the whole game so far. If they differ, for example when the thread's latest run carries no game record, the app shows no review (or "No game record") for that thread.

### Analyze: grading from the app

`analysis.ts` implements the Analyze button. The app never talks to the job after launching it; it only reads the `grade_status` feedback mark the job leaves on the game's last run.

```mermaid
stateDiagram-v2
    [*] --> Analyzing: app posts grade_status analyzing
    Analyzing --> Graded: replace writes game_review then deletes mark
    Analyzing --> Cleared: settle with no failure
    Analyzing --> Failed: settle updates mark to failed with log
    Analyzing --> Stalled: mark older than 10 minutes
    Failed --> Analyzing: Retry deletes old mark and sandbox
    Stalled --> Analyzing: Retry deletes old mark and sandbox
    Graded --> [*]
    Cleared --> [*]
```

*Lifecycle of the review app's `grade_status` mark. The app derives Stalled from the mark's age; the job only ever clears or fails the mark.*

`analyze(call, target, { force, previous })` does, in order:

1. If a previous failed or stalled mark exists, it deletes the old sandbox (ignoring "not found"), waits up to 10 polls of 1 s for it to disappear, and deletes the old mark.
2. It posts a `grade_status: analyzing` feedback on the game's last run with source metadata `grader: "lcchess grade"`.
3. It creates a sandbox named `sandboxName(threadId)` (`lcchess-grade-<sanitised id>`, at most 63 characters; one name per game, so a second start on the same game conflicts instead of running twice) from the `langchain-chess-grader` snapshot, with 4 vCPUs, 8 GiB, `idle_ttl_seconds: 900` as a backstop, and explicit access delegation limited to what the job needs: `projects:read`, `runs:read`, `runs:read-outputs`, `feedback:read/create/update/delete`, `sandboxes:delete` and `workspaces:read`. A bridge timeout on create is tolerated because the server keeps booting.
4. It polls the sandbox status until `ready` (a `failed` status or 10 polls without ready is an error).
5. It executes `gradeCommand`: `nohup setsid lcchess grade --project … --thread … --workers 4 [--force] --sandbox-job </dev/null >/tmp/grade.log 2>&1 &`, detached so the job outlives the execute call. A non-zero exit code is an error.

On any error after the mark is written, it deletes the mark and (if it may exist) the sandbox, and rethrows a message from `explain`, which maps known bridge errors to hints: sandboxes not enabled, the snapshot missing ("run mise run review:snapshot"), the sandbox limit reached, "already being analyzed", or a permissions problem. `App` passes `force: true` unless the game is ungraded.

`analysisOf(mark, now)` turns a mark into `analyzing`, `stalled` (an `analyzing` mark older than `STALL_MS`, 10 minutes, belongs to a job that died without reporting) or `failed` (with the comment as the log). `AnalysisBanner` then shows, in priority order: a launch error with "Try again"; "Analyzing…" while the tab's launch has started or the mark is analyzing; "Analysis didn't finish" with Retry for a stalled job; "Analysis failed" with the job's log and Retry; "Review unreadable" with the reason, Re-analyze and a `lcchess grade --thread <id> --force` hint for an invalid review; "Not graded yet" with Analyze and a `lcchess grade --thread <id>` hint for an ungraded game; and nothing for a graded game at rest. The launch button is disabled while starting so a second click can't launch twice. After a successful launch the app refreshes the list, and drops its local "started" state once the reloaded page carries the mark.

## The grader snapshot and its deploy workflow

The Analyze sandbox boots from a LangSmith snapshot named `langchain-chess-grader`:

- **Image** (`docker/grader.Dockerfile`): Ubuntu 24.04 with `ca-certificates` (the sandbox adds its proxy's CA to that bundle, which access delegation needs), an unmodified, checksum-verified Stockfish 19 binary at `/usr/local/bin/stockfish` with its licence files, and a Python 3.13 venv at `/opt/lcchess` into which `uv` installs the locked requirements and then the three workspace wheels with `--no-deps`. `PATH` includes the venv and `STOCKFISH_PATH` points at Stockfish, so `lcchess grade` works without flags.
- **Build** (`scripts/grader-snapshot.py`, run via `mise run review:snapshot`): stages a build context with the Dockerfile, wheels built by `uv build` for `langchain-chess`, `langchain-chess-systemone` and `langchain-chess-cli`, and a frozen `uv export` of the CLI's requirements. It then calls `SandboxClient.create_snapshot_from_dockerfile` so the build runs in a LangSmith sandbox (no local Docker needed). It tags the capture `latest` so the app's bare snapshot name resolves, and rebuilding moves the name to the new snapshot. It needs `LANGSMITH_API_KEY`, plus `LANGSMITH_WORKSPACE_ID` (sent as `X-Tenant-Id`) when the key reaches more than one workspace.
- **Deploy** (`.github/workflows/deploy-grader.yml`): on pushes to `main` that touch what the snapshot is built from (`libs/chess`, `libs/systemone`, `libs/cli`, the lockfile, the Dockerfile, the snapshot script, mise and CI config), or on manual dispatch from `main`, it resolves main's tip, runs the reusable CI workflow on that SHA, then builds the snapshot. Runs are queued in push order per ref. Before building, a guard uses `scripts/superseded.sh` to check whether a newer commit on main changed grader paths: if a newer non-cancelled run exists it skips, otherwise it fails so someone re-runs it. A missing path in the filter would silently leave a stale snapshot, so the list errs towards over-including.

## Extension points and invariants

- **Other engines**: any UCI binary works through `--engine`. The fingerprint includes its `id name`, so switching engines re-grades.
- **Other stores or pools**: `grade_batch` depends only on the `Store` protocol (`find_threads`, `thread_runs`, `graded`, `replace`) and on a `Pools` factory that yields an `Evaluator` (`grader`, `analyse`). `sandbox_job` depends on a `MarkStore` (`thread_runs`, `settle`). The tests swap in fakes for all of them.
- **Changing the review payload**: `records.review` and `apps/review/src/review.ts` must change together. The app treats any `version` other than 1, or any field it can't validate, as an unreadable review.
- **Changing grading math**: grading output does not change the fingerprint; only the engine and settings do. After changing `grading.py`, re-grade with `--force` to refresh existing grades.
- **Adding feedback keys**: add them to `PLY_KEYS`/`GAME_KEYS` so `replace` also deletes stale copies. Keep `game_review` as the last entry.
- **Changing what the job needs**: the sandbox's delegated permissions in `analysis.ts` cap what the job can do as the viewer. The snapshot only picks up code changes after it is rebuilt, which the deploy workflow does for paths in its filter.

## Tests that matter

- `libs/cli/tests/test_grade.py`:
  - rebuilding records from web-style runs (ply-to-run mapping, last run, ignoring noise runs)
  - where feedback goes (agent turns only, game keys and the marker last)
  - the exact review payload
  - store filters, `replace` ordering (only this grader's feedback deleted, markers deleted first, marker written last, `grade_status` cleared after it, retention extended), a failed delete never leaving a partial game marked graded, and `settle`
  - batch behaviour: each position evaluated once, pool size clamping, skip unless forced, dry run, a failure that keeps earlier writes
  - the sandbox job: `verdicts`, settling marks then deleting the sandbox, failing unwritten games with the log tail, `delete_own_sandbox`
  - option validation, printer output, and end-to-end CLI runs (normal and `--sandbox-job`) against a fake engine
- `libs/chess/tests/test_grading.py`: symmetry and clamping of winning chances, centipawn and mate judgements from the mover's side, move and game accuracy (including one Black move and long games), settled positions, `engine_fens` dedupe, `grade_game`, `first_runs` and `eval_json`.
- `libs/chess/tests/test_engine.py`: search limit mapping, settings that leave out the path, fingerprint sensitivity, White-side scores, the error when no score comes back, and pool start-up and shutdown with a fake engine.
- `apps/review/tests/`: logic (`logic.test.ts`), the Analyze flow (`analysis.test.ts`), components, `App`, and entry rendering.

See also [runtime behavior](/openwiki/operations/runtime-behavior.md) for how the traced runs that grading reads are produced, and [System 1 evals](/openwiki/workflows/system-one-evals.md) for offline evaluation of the move policy.
