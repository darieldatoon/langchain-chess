# langchain-chess-cli

The `lcchess` command. Play the agent in your terminal, plug it into any chess GUI as a UCI
engine, and grade finished games with Stockfish.

![The terminal UI: the LLM chose Bd7 over System 1's top move, with its analysis and the game so far](../../docs/images/tui-game.png)

For accounts, keys and the full setup, start with the [repository README](../../README.md).

## Install

**From a checkout** (recommended): `mise run setup` installs it, and every command below runs as
`uv run --all-packages --env-file .env lcchess ...`, which loads your `.env`. `mise run dev:tui`
and `mise run dev:uci` are shortcuts for exactly that.

**Without cloning.** The packages aren't on PyPI, so only uv can install it: it resolves the
sibling packages from the same commit, where pip would look for them on PyPI.

```sh
uvx --env-file /absolute/path/to/.env \
  --from "git+https://github.com/darieldatoon/langchain-chess#subdirectory=libs/cli" lcchess play
uv tool install "git+https://github.com/darieldatoon/langchain-chess#subdirectory=libs/cli"
```

An installed `lcchess` doesn't read `.env`, so export the variables from
[`.env.example`](../../.env.example) in your shell. Installing it doesn't install Stockfish or
fastchess; `mise install` does, in a checkout.

**Your own provider key.** The default model, `langsmith:baseten/zai-org/GLM-5.3-Flash`, goes
through the LLM Gateway. To call Anthropic directly instead, install the extra, set
`ANTHROPIC_API_KEY`, and unset `LANGSMITH_GATEWAY` (while it is `true`, bare model names also go
through the gateway):

```sh
uv tool install "langchain-chess-cli[anthropic] @ git+https://github.com/darieldatoon/langchain-chess#subdirectory=libs/cli"
lcchess play --policy llm --model claude-opus-5-5
```

Every command has `--help`, which documents each setting from `ChessContext`. A flag you leave
out keeps the setting's default. `--model-kwargs '{"temperature": 0.2}'` passes extra model
arguments; unlike the server, the CLI accepts provider tools too, and prices those calls as
incomplete.

`--config opponent.json` plays an opponent settings file, the same file the web UI exports.
Flags you give override it, and `--reset top_p` puts one of its settings back to the default:

```sh
lcchess play --config opponent.json --k 3 --reset reasoning_effort
```

## Play in the terminal

```sh
mise run dev:tui                                  # hybrid: SemIf + GLM-5.3 Flash
mise run dev:tui -- --side black --policy llm     # the LLM alone, you play Black
mise run dev:tui -- --fen "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"   # from a position
```

The screen follows the web app's: Last Reply on the left (under the moves below 160 columns),
the board between the two players' strips, and the opening, the moves and the game's controls
on the right. The flags set up the first game; `ctrl+n` opens the New Game screen, which picks
the side, the starting position, System 1, the LLM and the Advanced settings as the web app's
dialog does. Rematch keeps the opponent and swaps sides.

![The New Game screen](../../docs/images/tui-new-game.png)

- **Move** by typing SAN (standard notation, `Nf3`) or UCI (from and to squares, `g1f3`) and
  pressing Enter, by clicking a piece and then its target, or with the arrow keys and Enter (or
  Space) on the piece and again on the target. Legal targets are marked. Typing `go`,
  `resign` or `draw` works too, with the same checks as the keys.
- **Keys:**

  | Key | Does |
  |---|---|
  | `,` `.` | the previous and next move; Home and End, the first and the latest |
  | `ctrl+f` | flip the board |
  | `ctrl+g` | resign, after a confirmation |
  | `ctrl+o` | offer a draw |
  | `ctrl+n` | New Game |
  | `ctrl+s`, `ctrl+r` | ask the agent to open, retry its failed move |
  | `ctrl+p` | the command palette: Copy PGN, Copy FEN, Save PGN, Analyze on Lichess, themes |
  | `ctrl+q` | quit |

  The move list takes the arrow keys and clicks too. While you look at an earlier move, the
  board and the move input wait until you're back to live.
- **Themes:** `langchain` (dark) and `langchain-light`, built from the web app's colours; the
  palette's Change theme switches them. The light squares are darker than the web's, so the
  white block-art pieces (chess-tui's) stay visible. Below 160 columns, Last Reply moves under
  the moves:

  ![The light theme on a 130-column terminal](../../docs/images/tui-light.png)
- **Copy PGN and Copy FEN** go through your terminal's clipboard support (OSC 52), which some
  terminals, macOS Terminal among them, turn off. Save PGN always works: it writes
  `langchain-chess-<thread>.pgn` in the current directory.

## Use it as a UCI engine

```sh
mise run dev:uci -- --policy systemone
```

Type UCI commands to check it answers. With `--policy systemone` a move takes a second or two:

```text
> uci
id name langchain-chess
option name Config type string default <empty>
option name Model type string default langsmith:baseten/zai-org/GLM-5.3-Flash
option name ReasoningEffort type combo default default var default var low var medium var high
option name SystemOneModel type string default semif-qwen3.5-4b
option name Policy type combo default systemone var llm var systemone var hybrid
option name Threshold type string default 0.9
option name K type spin default 5 min 1 max 255
option name Memory type check default false
option name MoveList type combo default both var both var legal var candidates var none
option name Seed type spin default 0 min 0 max 2147483647
uciok
> isready
readyok
> position startpos moves e2e4
> go movetime 20000
bestmove g8f6
```

**In a GUI** (Cute Chess, Arena, En Croissant, fastchess), register a command that runs from the
repo root:

| Field | Value |
|---|---|
| Command | `uv` |
| Arguments | `run --all-packages --env-file .env lcchess uci --policy hybrid` |
| Working directory | Your clone |

- **Config** names an opponent settings file. It replaces every setting; the options after it
  patch it, so a tournament varies one option over a shared file. The engine never claims draws,
  whatever the file says. A file that fails to load changes nothing.
- **Time controls.** LLM moves take seconds. Each move gets a budget (the time left ÷ 30 plus
  the increment); past it, the engine plays this turn's System 1 top move if it ranked. Without
  one, the search runs until the clock is nearly out, then forfeits with `bestmove 0000`. It
  never plays a random move. `movetime` is a single deadline. A failed run also plays System 1's
  move or forfeits. GLM-5.3 Flash can take 30–60 seconds a move. Analysis streams as
  `info string` lines.
- **Endings.** A resignation (after four illegal replies), a finished game and a rejected
  position answer `bestmove 0000` with an `info string` reason. That's a null move, which
  fastchess scores as an illegal-move loss for the engine that played it: the intended forfeit.
  Draw claims are left to the GUI. `go ponder` and `ponderhit` work, but the engine advertises no
  `Ponder` option and never suggests a ponder move.
- `mise run test:uci` plays two SemIf-only games under fastchess as a smoke test.

## Grade games

`lcchess grade` replays games from their traces, grades every move with a UCI engine, and writes
the grades back to the traces as LangSmith feedback. The [review app](../../apps/review) shows
them.

```sh
# One game: the thread id is under Opponent in the web UI
uv run --all-packages --env-file .env lcchess grade --thread <thread-id>

# Your latest terminal game (the TUI doesn't show its thread id)
uv run --all-packages --env-file .env lcchess grade --metadata surface=tui --limit 1

# A batch from the deployment, listed but not written
uv run --all-packages --env-file .env lcchess grade --project langchain-chess-app \
  --since 2026-09-01 --metadata surface=web --limit 50 --dry-run
```

```text
grading 1 games, 17 positions on 15 x Stockfish 19 (depth 16, multipv 1, threads 1, hash_mb 256)
graded 01a0dc37-...: 16 plies, accuracy white 62.2 black 99.3 [17/17 positions, 15.9/s]
done: 1 graded, 0 skipped
```

```mermaid
flowchart LR
  runs[("Traced turns<br/>in a project")] --> replay["Rebuild each game's<br/>positions"]
  replay --> dedupe["Deduplicate positions<br/>across the batch"]
  dedupe --> sf["Stockfish workers"]
  sf --> grades["Grade each move:<br/>best … blunder, cp loss,<br/>accuracy"]
  grades --> turn["Per turn: move_quality,<br/>cp_loss, win_pct_loss, best_move"]
  grades --> game["Last turn: accuracy_white,<br/>accuracy_black, game_review"]
  turn --> fb[("LangSmith feedback")]
  game --> fb
```

- **Which project.** `--project` defaults to `LANGSMITH_PROJECT`: `langchain-chess-local` for
  local games, `langchain-chess-app` for the deployment.
- **Skips.** Games already graded with the same engine and settings are skipped; `--force`
  re-grades. Re-grading replaces this grader's earlier feedback and leaves other feedback alone.
- **Search.** `--depth` (default 16), `--nodes` or `--movetime`; also `--multipv`, `--hash`,
  `--workers`, `--engine-threads`. With one engine thread, `--nodes` gives the same grades on
  any machine. Each position starts from a cleared hash.
- **Engine.** `stockfish` on `PATH` (mise installs it), or `--engine` / `STOCKFISH_PATH`.
- **Grades** follow Lichess (a ply is one side's move; a full move is two plies): `move_quality` is `best`, `good`, `inaccuracy`, `mistake` or
  `blunder`, and `cp_loss` is how many centipawns (hundredths of a pawn) the move gave away. Moves that came in as input (yours, in the web UI) count toward `game_review` and
  the accuracies but get no per-turn feedback. Every entry's source info records the engine, the
  settings and their fingerprint.
- **From the review app.** The app's Analyze button runs `lcchess grade --thread <id>
  --sandbox-job` in a LangSmith sandbox. `--sandbox-job` settles the app's `grade_status` mark
  (cleared on success, `failed` with the log's last lines otherwise), then deletes its own sandbox.

## Test

```sh
uv run --all-packages pytest libs/cli --no-cov -q
uv run --all-packages pytest libs/cli/tests/test_tui_snapshots.py --snapshot-update --no-cov   # after a UI change
```
