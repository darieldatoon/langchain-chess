---
type: integration
title: Terminal UI (lcchess play)
description: How `lcchess play` runs a Textual game against an in-process chess agent (board widget, move input, key bindings, start/retry/new game, checkpoint cleanup), and how the CLI's shared flags, `--config`/`--reset` overlay, the shared `build_agent` and `run_config` configure `play` and `uci` from one `ChessContext`.
tags: [cli, tui, textual, lcchess, settings, chess-context, tracing, installation]
verified:
  - by: openwiki/0.6.0
    at: 2026-09-27T19:08:28.877Z
sources:
  - id: openwiki-source-65bee4ff16ecbe51243c1e47
    resource: repo://libs/chess/langchain_chess/chat_models.py
  - id: openwiki-source-abe54986bd51a87223916132
    resource: repo://libs/cli/langchain_chess_cli/main.py
  - id: openwiki-source-595fa5f62bc6bdbfd212eed8
    resource: repo://libs/cli/langchain_chess_cli/options.py
  - id: openwiki-source-4a28e26b3d1b4d88ed096459
    resource: repo://libs/cli/langchain_chess_cli/tui/app.py
  - id: openwiki-source-510524fae844c1c2b49b20af
    resource: repo://libs/cli/langchain_chess_cli/tui/board.py
  - id: openwiki-source-b5fa1d6f5447d2f67ca99846
    resource: repo://libs/cli/langchain_chess_cli/tui/view.py
  - id: openwiki-source-1dd02340acf0ca7c8c33f18b
    resource: repo://libs/cli/langchain_chess_cli/uci/engine.py
  - id: openwiki-source-209a02af6c0ad75814326da0
    resource: repo://libs/cli/pyproject.toml
  - id: openwiki-source-75f1e442bb6ed78ddb1df39d
    resource: repo://libs/cli/README.md
  - id: openwiki-source-d439fc6a30e914d13e0be301
    resource: repo://libs/cli/tests/test_main.py
  - id: openwiki-source-308d3e2d4f747b9aa24ee4b1
    resource: repo://libs/cli/tests/test_options.py
  - id: openwiki-source-6eea8483a27fbf889dd46261
    resource: repo://libs/cli/tests/test_tui_snapshots.py
  - id: openwiki-source-d60c17baa509db20901ff1ac
    resource: repo://libs/cli/tests/test_tui_view.py
  - id: openwiki-source-c725c52434f876038c206f6e
    resource: repo://libs/cli/tests/test_tui.py
  - id: openwiki-source-c228b1f5ddeb31cb2374ed59
    resource: repo://libs/systemone/langchain_chess_systemone/agent.py
  - id: openwiki-source-21de6a067affac443ab60933
    resource: repo://libs/systemone/langchain_chess_systemone/settings.py
  - id: openwiki-source-95af6ce374db999cf2c4a7e0
    resource: repo://libs/systemone/tests/test_agent.py
  - id: openwiki-source-72b5d686f860ea86c8592080
    resource: repo://mise.toml
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "openwiki/0.6.0", at: "2026-09-27T19:08:28.877Z" }
---

# Terminal UI (`lcchess play`)

The `langchain-chess-cli` package (`libs/cli`) ships one console script, `lcchess`, with three Typer subcommands: `uci`, `play` and `grade` ([main.py](../../libs/cli/langchain_chess_cli/main.py)). This page covers `play`, which runs a [Textual](https://textual.textualize.io/) terminal game against the chess agent in the same process. It also covers the option layer that `play` shares with `uci`. Both commands turn their flags into one `ChessContext` (the same settings model the server and web UI use) and build the agent with the shared `build_agent` from `langchain_chess_systemone.agent`. The settings model, settings files and model arguments are explained on [Settings and model arguments](../concepts/settings-and-model-arguments.md). The UCI adapter has its own page, [UCI engine](uci-engine.md). Games played here can be graded afterwards with `lcchess grade --metadata surface=tui` (see [Grading and review](../workflows/grading-and-review.md)).

## Installing and running

The packages aren't published on PyPI. Only uv can install the CLI without a clone, because uv resolves the sibling workspace packages from the same git commit. pip would look for them on PyPI and fail ([libs/cli README](../../libs/cli/README.md)):

```sh
uvx --env-file /absolute/path/to/.env \
  --from "git+https://github.com/darieldatoon/langchain-chess#subdirectory=libs/cli" lcchess play
uv tool install "git+https://github.com/darieldatoon/langchain-chess#subdirectory=libs/cli"
# your own Anthropic key instead of the gateway (set ANTHROPIC_API_KEY, unset LANGSMITH_GATEWAY):
uv tool install "langchain-chess-cli[anthropic] @ git+https://github.com/darieldatoon/langchain-chess#subdirectory=libs/cli"
lcchess play --policy llm --model claude-opus-5-5
```

An installed `lcchess` doesn't read `.env`, so the variables from `.env.example` must be exported in the shell. While `LANGSMITH_GATEWAY` is `true`, bare model names also go through the LLM Gateway, so calling a provider directly needs both the extra and the gateway turned off.

`pyproject.toml` maps `lcchess` to `langchain_chess_cli.main:app`. It requires Python ≥ 3.13 and depends on `langchain-chess[systemone]`, `langchain-openai`, `langsmith`, `textual>=6`, `typer` and `rich`. The only optional extra is `anthropic` ([pyproject.toml](../../libs/cli/pyproject.toml)). In a clone, `mise run dev:tui` runs `uv run --all-packages --env-file .env lcchess play`. Pass extra options after `--`, for example `mise run dev:tui -- --side black` ([mise.toml](../../mise.toml), [README](../../README.md)).

## Shared settings flags

`play` and `uci` take one flag per `ChessContext` setting. The CLI keeps no settings type or defaults of its own. The helper `_setting(name)` builds each Typer option from the `ChessContext` field: the help text is the field's description, and the shown default is the field's default. Typer can't read PEP 695 aliases, so `main.py` repeats the choices as `Annotated` `Literal` types, with ranges enforced (for example `--threshold` must be in 0–1 and `--k` in 1–255). Every flag defaults to `None`, meaning "not given". A flag you leave out therefore keeps whatever the base settings say.

| Flag | Default (from `ChessContext`) | Meaning |
| --- | --- | --- |
| `--policy` | `hybrid` | `llm` (model alone), `systemone` (System 1 alone), `hybrid` (both) |
| `--model` | `langsmith:baseten/zai-org/GLM-5.3-Flash` | `init_chat_model` spec. A bare name needs its provider package |
| `--reasoning-effort` | unset | `low` / `medium` / `high`; unset uses the model's default |
| `--model-kwargs JSON` | `{}` | Extra model arguments as a JSON object |
| `--system-prompt` | none | Replaces the agent's system prompt |
| `--show-fen`, `--show-board` | on | What the prompt shows of the position |
| `--move-list` | `both` | `both` / `legal` / `candidates` / `none` |
| `--memory` / `--no-memory` | off | Summarize older conversation |
| `--systemone-model` | `semif-qwen3.5-4b` | System 1 model (SemIf or Jev) |
| `--threshold`, `--tournament-threshold` | `0.9`, none | Gate value at or above which System 1 plays |
| `--gate` | `margin` | `margin` or `confidence` |
| `--k`, `--top-p` | `5`, none | Candidates suggested to the model |
| `--style` | `rich` | How moves are described to System 1 (`rich`/`terse`) |
| `--with-eval`, `--with-nouls` | off | Extra System 1 questions (recorded only) |
| `--seed` | `0` | Seeds System 1's tournament shuffle |

Defaults are those of settings version 2 in [settings.py](../../libs/systemone/langchain_chess_systemone/settings.py). `play` also takes `--side white|black` (default `white`) and `--draw-claims auto|never`. `uci` has no `--draw-claims` flag, because the engine always forces `draw_claims="never"` and leaves draws to the GUI.

### `--config`, `--reset` and the overlay

Both commands resolve their settings the same way, in `main._settings`:

1. The base is `load_file(--config)` when a settings file is given, or `ChessContext()` otherwise. This is the same versioned JSON file the web UI exports. A file without a `version`, with unknown keys, or with invalid JSON is rejected.
2. `--model-kwargs` is parsed from JSON.
3. `options.overlay(base, flags, resets)` puts every `--reset` setting (repeatable) back to its `ChessContext` default, then applies the flags that were given (non-`None`). It validates the result again as a `ChessContext`. Resetting an unknown key or `version` raises a `SettingsError` ("no such setting to reset: ...").

Any `ValueError` in these steps becomes `typer.BadParameter`, so the command exits with code 2. This covers a bad settings file, bad JSON in `--model-kwargs`, a validation failure such as an empty `--model` or a disallowed model argument like `base_url`, and an unknown reset.

```mermaid
flowchart LR
  file["--config file or ChessContext()"] --> reset["--reset keys back to defaults"]
  reset --> flags["given flags applied"]
  flags --> ctx["validated ChessContext"]
  ctx --> play["play: ChessApp factory"]
  ctx --> uci["uci: Engine factory"]
```
*How a CLI command turns a settings file, resets and flags into one `ChessContext`.*

### `build_agent`

Both surfaces build their agent with `langchain_chess_systemone.agent.build_agent(settings, *, checkpointer=..., ...)` ([agent.py](../../libs/systemone/langchain_chess_systemone/agent.py)). That is the same builder the server uses, so the CLI adds no middleware or model logic of its own. In short:

- For any policy except `llm`, it adds `SystemOneMiddleware`. For `systemone`, it never calls the model factory. The middleware gets `threshold=0.0`, `tournament_threshold=0.0` and `has_model=False`, so System 1 always plays.
- Memory is on only when `settings.memory` is set and there is a model. With `policy=systemone`, `--memory` is silently dropped. If memory is on and the model's profile has no known input limit (`input_limit(model)` is `None`), it raises `ChessContractError`: "<model> has no known input limit, so it can't use memory; turn it off".
- The default model is `chat_model(settings.model, arguments(settings))` from the core package, where `arguments` merges `model_kwargs` over `reasoning_effort`. `chat_model` sets an output budget of `MAX_TOKENS = 64000`, capped by the model's own output limit and by half of a smaller context window. It names the trace span after the bare model name, and sends a reasoning effort only when one is set. For `langsmith:` gateway specs with a known window, it adds a profile with `max_input_tokens = window - budget` ([chat_models.py](../../libs/chess/langchain_chess/chat_models.py)). The details are on [Models, gateway and cost](../concepts/models-gateway-and-cost.md).
- The remaining settings (system prompt, FEN/board display, move list, draw claims, seed) are passed to `create_chess_agent`. The graph is named `chess`.

`play` builds a closure `factory(checkpointer)` that calls `build_agent(settings, checkpointer=checkpointer)`, and draw claims follow `settings.draw_claims` (default `auto`). `uci`'s factory takes `(settings, checkpointer)`, and the engine replaces `draw_claims` with `never` before building. Because `ChessApp` calls the factory in its constructor, a build error such as the memory check above is raised before the TUI opens.

### `run_config`

`run_config(surface, thread_id, settings)` in [options.py](../../libs/cli/langchain_chess_cli/options.py) builds the `RunnableConfig` for every agent invocation:

- `configurable.thread_id` is the game thread.
- `run_name` is `chess-<surface>`, and `tags` is `[surface]`.
- `metadata` holds `surface`, every settings key through `dump(settings)` (including `version`, `model_kwargs` and `draw_claims`), and then `sent(settings)`. `sent` overwrites `reasoning_effort` with the effort actually sent, after `model_kwargs` has been applied, and adds `max_tokens` when `model_kwargs` sets it. With `policy=systemone` the recorded effort is `None`.

Both the TUI (`surface="tui"`) and the UCI engine (`surface="uci"`) call it, so CLI traces carry the same settings metadata as server traces. The `grade` command's `--metadata surface=...` filter relies on that metadata. The TUI doesn't show its thread id, so `lcchess grade --metadata surface=tui --limit 1` is how you find your latest terminal game.

## The Textual app

`play` runs `ChessApp(factory, settings, side=side).run()`. In `__init__`, `ChessApp` creates its own `InMemorySaver`, calls the factory once with it, and keeps the agent for the whole session. Games in the TUI therefore last only as long as the process, and even less than that: a new game deletes the previous game's checkpoints (see below). The app holds all game state:

- `settings`: the `ChessContext` the agent was built from.
- `side`: the human's colour.
- `thread`: `tui-<uuid4>`, set by the first new game on mount.
- `checkpointer`: the saver shared by every game in the session.
- `values`: the last state snapshot of the thread.
- `running`, `failed` (error text) and `analysis` (streamed model text).

### Layout

The layout comes from `compose`:

- A `Header`. Its subtitle comes from `describe_settings`, for example `semif-qwen3.5-4b + <model>`, `System 1 alone (...)` or `<model> (<effort>)`. The effort is taken from `sent(settings)`, so it reflects a `reasoning_effort` given in `--model-kwargs` too. The suffix appears only when an effort is set.
- The `ChessBoard` widget, two-thirds of the width.
- A side column with:
  - `#status`: whose move it is, the result, or the failure reason.
  - `#details`: the last agent move's source, model, latency and cost, the count of illegal attempts, and System 1's status and top moves with probabilities.
  - `#moves`: a numbered move list with each move's source (`you`, `LLM`, `System 1`, `forced`) and turn cost. The cost shows `—` if nothing was priced and `≥$` if the estimate is incomplete.
  - A scrolling `Analysis` box.
- An `Input` for notation.
- A `Footer`.

The side-panel `Static` widgets use `markup=False`, so model output, errors and SAN are shown literally and never parsed as Rich markup (text like `[/]` or `[bold]` can't break or restyle the display).

All side-panel text comes from pure functions in [view.py](../../libs/cli/langchain_chess_cli/tui/view.py). They read the thread record: `start_fen`, `moves`, `plies`, `turns`, `outcome` and `error`. `board_of` rebuilds the `chess.Board` by replaying `moves` from `start_fen`. The TUI keeps no board of its own. The thread state is the only source of truth.

### Key bindings and input modes

| Key | Where | Action |
| --- | --- | --- |
| `ctrl+n` | app | New game (new thread) on the current side |
| `ctrl+f` | app | Switch sides and start a new game |
| `ctrl+s` | app | Start: the agent opens when you play Black |
| `ctrl+r` | app | Retry the agent's failed (pending) turn |
| `ctrl+q` | app | Quit |
| arrows | board | Move the cursor (directions follow the board's orientation, clamped at the edges) |
| `enter` / `space` | board | Select a piece, or move the selected piece to the cursor square |
| `escape` | board | Deselect |
| `q`/`r`/`b`/`n`, `escape` | promotion dialog | Pick the promotion piece, or cancel |

You can enter a move in three ways, and all of them submit the same kind of human message:

1. **Mouse.** Click a piece of the side to move, then one of its legal targets.
2. **Keyboard on the board.** Move the cursor, then press Enter on the piece and again on the target.
3. **Notation.** Type SAN or UCI in the `Input` and press Enter. If you type a printable character other than space while the board has focus, the board posts `ChessBoard.Typed`. The app moves focus to the input and inserts the character. The input uses `select_on_focus=False` so the first character isn't overwritten. After you submit, the input clears and focus returns to the board. Empty lines are ignored.

The app does not check notation itself. The agent's input parsing decides, and a bad entry shows up as the thread's `error` in red under the status line. For example, `Qh8` gives "neither `go` nor a legal move" ([test_tui.py](../../libs/cli/tests/test_tui.py)).

### The board widget

[board.py](../../libs/cli/langchain_chess_cli/tui/board.py) keeps pure layout and drawing apart from the interaction state in `ChessBoard`.

- **Geometry.** `geometry(width, height, white_bottom=...)` picks the largest square height that fits. Square width is `2*h+1`, so squares look about square on screen. The board is centred, with a two-cell rank-label column and a file-label row underneath. `Geometry.square_at` maps click offsets back to squares for either orientation. Piece art (from chess-tui) is scaled to the square size.
- **Highlights.** `background_role` sets the priority for each square: selected, then cursor (shown only while the board has focus), then king in check, then capture target, then last move (light or dark), then plain light or dark. Empty legal targets get a `●`. Each role is a `chess-board--<role>` component class, so CSS or themes can restyle the board. The defaults are chess-tui's skin with lichess-like highlights.
- **Interaction.** `show(board, white_bottom, last_move, interactive)` is the app's only way to push state into the widget. It clears the selection when the position changes or the board becomes non-interactive. If you try to select while the board isn't interactive, you hear a bell. When a move has several promotion options, the widget opens `PromotionScreen`, and the chosen letter is appended to the UCI string. Cancelling posts nothing. A completed move posts `ChessBoard.Moved(uci)`, and the app handles it like typed notation.

### Runs, start, retry and new game

```mermaid
sequenceDiagram
    participant U as User
    participant App as ChessApp
    participant W as Run worker
    participant Agent as Chess agent
    U->>App: move, ctrl+s, or ctrl+r
    App->>App: guard checks, running = True
    App->>W: run_worker(_invoke(payload, thread), group agent-run)
    W->>Agent: astream with run_config tui
    loop each chunk
        Agent-->>W: values or model message
        W->>App: update values or analysis, refresh
    end
    W->>Agent: aget_state
    W->>App: values = final state, running = False, refresh
    U->>App: ctrl+n
    App->>W: cancel group agent-run
    App->>App: _forget worker waits for cancelled runs, then adelete_thread(old thread)
```
*How one agent run works in the TUI, and how a new game retires the previous one.*

`_submit` sets `running=True` and clears `failed` and `analysis`. It then starts a Textual worker in the `agent-run` group (`RUN`) that streams `agent.astream(payload, config, stream_mode=["messages", "values"])` on the thread captured at submit time, with `config = run_config("tui", thread, settings)`. `values` chunks replace `self.values`. Message chunks from the `model` node are appended to the Analysis pane as they arrive. After the stream, including after an ordinary exception, the worker reloads the state with `aget_state` and clears `running`. An exception sets `failed` to the error text (or the exception type name). The agent's turn stays `pending` in the thread, and retry resumes it.

Start and retry are separate actions, as in the web UI:

- **Start** (`ctrl+s`) sends a human `go` message. It only does this when nothing is running, no turn is pending, no moves have been played, and it's the agent's turn. `action_new_game` calls it automatically when you play Black, so it's a no-op for White or after the game has started.
- **Retry** (`ctrl+r`) sends an empty payload `{}` on the same thread. The agent then resumes its pending turn instead of starting a new one. It only does this when nothing is running and the last turn is `pending`, so pressing it with nothing pending does nothing. A retried turn is committed once ([test_tui.py](../../libs/cli/tests/test_tui.py)).
- **Moves** go through `_play`. If the agent is running, a turn is pending, or the game is over, you get a warning to wait or retry. If it isn't the human's turn, you get "It's the agent's move." The board is interactive only when all of these checks pass (`_can_move`).
- **New game** (`ctrl+n`, or `ctrl+f` with a side switch) first cancels every worker in the `agent-run` group, so the previous game's run stops instead of delivering late events, failures or a final refresh (cancellation isn't caught by the run's `except Exception`). If there was a previous thread, it starts a `_forget` worker. That worker waits for the cancelled runs to unwind (suppressing `WorkerCancelled` and `WorkerFailed`) and then calls `checkpointer.adelete_thread(old_thread)`, because nothing can reopen a retired game. The app then creates a new `tui-<uuid>` thread, resets `values`, `running`, `failed` and `analysis`, and refreshes. Finished games are dropped the same way.

Game over (`outcome` set) makes `status_text` show `result_text(outcome)`, for example "Checkmate, black wins. 0-1", and blocks further input.

## Tests

Tests for this topic live in `libs/cli/tests` (see [Testing conventions](../testing/testing-conventions.md)). The CLI README runs them with `uv run --all-packages pytest libs/cli --no-cov -q`.

- `test_tui.py` drives `ChessApp` with Textual's `run_test` pilot and a `ScriptedModel`, using a factory `lambda saver: create_chess_agent(model, checkpointer=saver)`. It covers:
  - a failed first turn as Black, where input is blocked and retry commits exactly once;
  - analysis streaming before the run ends;
  - `ctrl+s` as a no-op for White;
  - the move list and details formatting;
  - input blocked while the agent is thinking;
  - late events and failures from the previous game not showing after `ctrl+n`;
  - a new game cancelling the in-flight run (`WorkerState.CANCELLED`) and leaving no checkpoints for the old thread, for both running and finished games;
  - `ctrl+f` starting the agent;
  - game-over blocking;
  - model and error text shown literally, without markup parsing;
  - moving by clicking;
  - typing on the board filling the input.
- `test_tui_snapshots.py` holds SVG snapshot regressions (`snap_compare`). They cover three board sizes, a selected piece with its targets, Black's orientation with the cursor, the promotion dialog, and the full game screen. The game screen is a `ChessApp` built with `ChessContext(policy="llm")` after playing `e4`, with the latency clock patched to zero so a slow runner can't change the displayed "0.0 s". After a deliberate visual change, run `uv run --all-packages pytest libs/cli/tests/test_tui_snapshots.py --snapshot-update --no-cov` and look at the SVGs under `__snapshots__/` before you accept them.
- `test_tui_view.py` and `test_tui_board.py` unit-test the pure view and board functions, including `describe_settings` picking up an effort from `model_kwargs`.
- `test_options.py` checks that `overlay` applies only given flags and revalidates, that resets happen before flags and reject unknown keys and `version`, and that `run_config` names the trace by surface and records every setting plus the values sent.
- `test_main.py` checks that `play --side black --policy systemone --memory` builds an agent named `chess` and runs the app. It also checks that `--help` documents flags with the settings' descriptions and defaults, and that a `--config` file combines with flags and `--reset`. Bad choices, an empty model, bad `--model-kwargs` JSON or a `base_url` model argument, a malformed config file, and a UCI seed outside the engine's range all exit with code 2.
- `build_agent` itself is tested in `libs/systemone/tests/test_agent.py`: the policy stacks, System 1 alone never building a model, the memory input-limit check, and the default gateway model.
