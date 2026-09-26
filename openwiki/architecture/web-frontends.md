---
type: architecture overview
title: Web frontends (apps/web, apps/review, packages/chess-ui)
description: How the React play UI (apps/web) drives the chess graph through useStream with one thread per game and continues any game from the setup recorded in its thread, how the LangSmith review app (apps/review) reads threads and game_review feedback, and how both share packages/chess-ui as TypeScript source inside a Vite+ pnpm workspace.
tags: [frontend, react, web-ui, review-app, chess-ui, vite-plus, useStream, game-setup]
verified:
  - by: openwiki/0.6.0
    at: 2026-09-26T13:04:36.303Z
sources:
  - id: openwiki-source-e38522714f61b06be12390be
    resource: repo://apps/review/src/api.ts
  - id: openwiki-source-c29d1556d6d26b04617e532d
    resource: repo://apps/review/src/App.tsx
  - id: openwiki-source-8e17609d88ef23327924a49d
    resource: repo://apps/review/src/components/GameView.tsx
  - id: openwiki-source-e638a34b89744693d4cca32c
    resource: repo://apps/review/src/entry.tsx
  - id: openwiki-source-471a9092cd5b3971e06785cb
    resource: repo://apps/review/src/games.ts
  - id: openwiki-source-4b7b32df95b288a82a7b22a8
    resource: repo://apps/review/src/global.d.ts
  - id: openwiki-source-4a50211e51ae5b4042cd6e74
    resource: repo://apps/review/src/review.ts
  - id: openwiki-source-f93334adeeacab16f8dc8d99
    resource: repo://apps/review/src/values.ts
  - id: openwiki-source-1c7945f632aab9aad6118b88
    resource: repo://apps/review/vite.config.ts
  - id: openwiki-source-b9886f4aee6bc16bdaea61ff
    resource: repo://apps/server/langchain_chess_server/app.py
  - id: openwiki-source-88d085345a1ecd09c61f7ab0
    resource: repo://apps/server/langchain_chess_server/game_setup.py
  - id: openwiki-source-c9b903d37e22daedc4499a4b
    resource: repo://apps/server/langchain_chess_server/graph.py
  - id: openwiki-source-1b589132a05fcfdecd7cc1d4
    resource: repo://apps/web/src/App.tsx
  - id: openwiki-source-6bcec85ddd7955325f5b1865
    resource: repo://apps/web/src/auth.ts
  - id: openwiki-source-6c16a0bf13a1dee1d6a311ca
    resource: repo://apps/web/src/commands.ts
  - id: openwiki-source-69320542b148a0b7ce9830b7
    resource: repo://apps/web/src/components/AdvancedSettings.tsx
  - id: openwiki-source-122f779bf6eb18ae91667e7f
    resource: repo://apps/web/src/components/NewGameDialog.tsx
  - id: openwiki-source-63a59ecdfb2c0567127b7b6f
    resource: repo://apps/web/src/format.ts
  - id: openwiki-source-f78d0b7d64a02f657382652c
    resource: repo://apps/web/src/index.css
  - id: openwiki-source-434b43fa9c75a1218beca2f5
    resource: repo://apps/web/src/modelLimit.ts
  - id: openwiki-source-3cb426dd15d324cb1ef8679d
    resource: repo://apps/web/src/settings.ts
  - id: openwiki-source-be4a82601d4a0ee9e1634703
    resource: repo://apps/web/src/setup.ts
  - id: openwiki-source-1076e2fa932ac0d1c637b001
    resource: repo://apps/web/src/storage.ts
  - id: openwiki-source-611421396243f4b643f6d94a
    resource: repo://apps/web/src/useGame.ts
  - id: openwiki-source-73497c2d4a05821b17429812
    resource: repo://apps/web/tailwind.config.cjs
  - id: openwiki-source-af065fe99821f520742e70e5
    resource: repo://apps/web/tests/support/fakeStream.ts
  - id: openwiki-source-064d1949ab454fb89e782b7d
    resource: repo://apps/web/tests/useGame.sdk.test.tsx
  - id: openwiki-source-03f6dd3375679341910a29c1
    resource: repo://apps/web/vite.config.ts
  - id: openwiki-source-0c21b06ab993756e943b973e
    resource: repo://packages/chess-ui/package.json
  - id: openwiki-source-52f19ad58ec6882226bc4a43
    resource: repo://packages/chess-ui/src/chess.ts
  - id: openwiki-source-15a1d3b1618239efaf01080e
    resource: repo://packages/chess-ui/src/selectors.ts
  - id: openwiki-source-fd0e9360c0eb5b2cec5ea440
    resource: repo://packages/chess-ui/src/types.ts
  - id: openwiki-source-40275cb92c3610938f16ade3
    resource: repo://pnpm-workspace.yaml
  - id: openwiki-source-5e1b077422a94ae165e88e4e
    resource: repo://vite.config.ts
generated: { by: "openwiki/0.6.0", at: "2026-09-26T13:04:36.303Z" }
---

# Web Frontends

The JavaScript side of the repository has three packages in one pnpm workspace. `apps/web` is the play UI. `apps/review` is a LangSmith custom app for looking at graded games. `packages/chess-ui` holds the board, move list, types and selectors that both apps use (`pnpm-workspace.yaml`). None of them import Python. The web app reaches the agent over the Agent Server HTTP API. The review app only talks to the LangSmith API. For the server side of that boundary, see [Agent Server integration](/openwiki/integrations/agent-server.md). For the thread values the UIs read, see [State record](/openwiki/concepts/state-record.md).

```mermaid
flowchart LR
  subgraph Workspace["pnpm workspace (Vite+)"]
    Web["apps/web"]
    Review["apps/review"]
    UI["packages/chess-ui (TS source)"]
  end
  Web -->|"useStream on graph chess"| AS["Agent Server"]
  AS -->|"serves build at /ui/"| Web
  Review -->|"window.langsmith.call"| LS["LangSmith API"]
  Web --> UI
  Review --> UI
```
*The two apps, the shared package, and the one remote system each app talks to.*

## apps/web: the play UI

### Entry and served location

`src/main.tsx` mounts `App` inside `StrictMode`, `AppThemeProvider` and `TooltipProvider`. The Vite config builds with `base: "/ui/"` and writes the bundle into `apps/server/langchain_chess_server/static` (`apps/web/vite.config.ts`). In production, the Python app (`apps/server/langchain_chess_server/app.py`) mounts that directory at `/ui` and redirects `/ui` to `/ui/`. It mounts under `/ui` rather than `/` because `/` is the server's health check. When no build exists, `/ui/` returns a 404 that tells you to run `mise run build` or `vp dev`.

`apiUrl()` in `src/settings.ts` decides where the API is:

1. If `VITE_API_URL` is set, it uses that.
2. Otherwise, under `vp dev`, it uses `http://localhost:2024` (`langgraph dev`).
3. Otherwise it uses `window.location.origin`, since production serves the UI from the same origin.

The build splits vendor code into long-lived chunks (react, langchain, chessboard, ui). There is deliberately no catch-all vendor group, so the lazily loaded Markdown chunk stays separate.

### useGame: one useStream, one thread, one game

`useGame(apiKey, chosen)` in `src/useGame.ts` is the only connection to the agent. It opens one `useStream<ChessValues>` from `@langchain/react` with `assistantId: "chess"`, the chosen `apiKey` (omitted when empty) and the current `threadId`. `chosen` is a new game's side and context (a `GameRecord`). It is used only until the thread records its own setup, and it is `null` for a game opened from a link. Everything the page renders is derived from `stream.values`:

- It replays `start_fen` plus `moves` with chess.js (`replay` from chess-ui) to get the board FEN and fallback SANs.
- It builds move-list entries from `plies`, falling back to SAN and then UCI. Moves without a ply are labelled `external`.
- `record` is the game's side and context, from `gameOf(values, chosen)` (see [Continuing a game from its thread](#continuing-a-game-from-its-threads-setup-record)).
- `lastReply` is the last ply whose source isn't `external` (`lastPolicyPly`), plus its turn record (`turnOf`) and the FEN it was chosen from.
- While a run is streaming, `liveAnalysis` shows the newest AI text after the current turn opened. It skips messages that already committed a ply, so the previous move's analysis never shows up as live.
- `pendingTurn` is true when the last turn record has status `pending` (`isPending`).
- `restore` says whether the thread has loaded (see below).

Every submit goes through one `send` helper. It passes `config: { configurable, run_name: "chess-web", tags: ["web"] }`, `metadata: { surface: "web" }` and `multitaskStrategy: "reject"`. The `configurable` object contains exactly the `ChessContext` fields and nothing else (`configurableOf`). It is built from `record.context`. When there is no record, `DEFAULT_CONTEXT` stands in, but in that case the board stays locked, so the stand-in never reaches a run.

The hook exposes three actions:

| Action | What it sends | When the UI offers it |
|---|---|---|
| `play(uci, fenAfter)` | a human message whose content is the UCI move | when you drop a piece on an unlocked board |
| `start()` | a human message `go` | "Start" / "Ask opponent to move": opponent to move, no pending turn |
| `retry()` | empty input `{}`, which resumes the pending turn | "Retry": a run failed mid-turn (pending turn) |

A fresh `go` would be rejected while a turn is pending, so after a failure the only way forward is an empty submit. `play` is optimistic: it stores a `pendingMove` (UCI and FEN after the move) and the board shows it until the submit settles, whether it succeeds or fails.

### Thread in the URL and loading

A game is a thread, and the page records the thread in the `?thread=` query parameter. `threadFromUrl` reads it when the hook mounts, and `writeThreadToUrl` updates it with `history.replaceState`, so no history entries are added. When `useStream` reports a new thread id through `onThreadId`, the hook binds it in state and writes it into the URL. This happens only while the hook is still mounted. A replaced game's stream can report its id late, and that report must not rebind the page. The browser stores nothing per game: the game's settings live in the thread itself.

A game from the URL can only be played once it has loaded. `restore` tracks each load by the SDK's `hydrationPromise`:

- `loading` while `isThreadLoading`,
- `missing` when a load for a thread id settles cleanly but binds no thread (the SDK settles a 404 that way),
- `failed` when the load rejects,
- `ready` otherwise.

A superseded load that settles late can't overwrite the current one's outcome. A changed API key creates a new client, which loads the thread again. The `Table` shows a "Couldn't load this game" banner with a Reload button for `failed`, and a "This game isn't on the server" banner for `missing`. Reload remounts the table on the same thread (a new seat number, same URL).

To start a new game or a rematch, `App` clears the URL parameter and creates a new `Seat` with a higher `number` and a `chosen` record (a rematch swaps sides and keeps the context). The `Table` is keyed by that number, so it remounts and `useStream` starts with `threadId: null`, which makes a fresh thread. If the human plays Black, the seat has `autoStart` set and the table sends `go` once when it mounts. A ref guards that effect, because StrictMode runs mount effects twice.

```mermaid
sequenceDiagram
  participant U as User
  participant T as Table
  participant G as useGame
  participant S as useStream
  participant AS as Agent Server
  U->>T: drop piece
  T->>G: play uci fenAfter
  G->>G: set pendingMove
  G->>S: submit human message with stable id
  S->>AS: run on thread, multitask reject
  AS-->>S: onThreadId on first run
  S-->>G: thread id
  G->>G: bind thread and write it to URL
  AS-->>S: streamed values incl. setup on first turn
  S-->>G: values moves plies turns setup
  G->>G: clear pendingMove
```
*One human move, from the drop to the settled thread values.*

### Continuing a game from its thread's setup record

Any client can continue a game from its thread alone, because the server records the game's settings in the thread. `GameSetupMiddleware` (`apps/server/langchain_chess_server/game_setup.py`) adds a public `setup` channel to the graph state. It writes the run's resolved `ChessContext` into `setup` only in the run that opened the game's first turn, and never again. It does this both before and after the agent, so the record exists even when the first turn fails or ends the game. Later runs still play with whatever context they send, but `setup` keeps naming the first turn's settings. A thread created before `setup` existed never gets one. The middleware state marks `setup` as `OmitFromInput`, so a client can't write it.

On the client, `ChessValues.setup` mirrors that channel, and `gameOf(values, chosen)` in `src/setup.ts` produces the game's `GameRecord`:

- **Context.** It uses `recordedContext(values.setup)`. This helper is strict: it accepts the record only when *every* `ChessContext` key is present and passes `CONTEXT_CHECKS`. A context patched with defaults would play a different game. When there is no valid record, it falls back to `chosen.context`, which covers a new game before its first turn is recorded. If neither exists, the record is `null`.
- **Human side** (`humanSideOf`). The human plays the `external` moves, so the side of the last external ply decides. Before any external ply, the human is the opposite of whoever played ply 0. Before any move at all, it is the picked side, or else the side *not* to move, because the opponent's first turn is still open.

```mermaid
flowchart TD
  A["values.setup"] --> B{"every knob valid?"}
  B -->|yes| C["context = recorded setup"]
  B -->|no| D{"chosen from dialog?"}
  D -->|yes| E["context = chosen.context"]
  D -->|no| F["record = null: view only"]
  C --> G["side from plies, else picked side, else side not to move"]
  E --> G
  G --> H["GameRecord pins configurable for every run"]
```
*How the web UI decides which setup a thread is played with.*

So opening a link `?thread=<id>` creates a seat with `chosen: null`. Once the thread loads, its `setup` supplies the opponent and knobs, and its plies supply the human's colour. Every later command sends exactly that context as `configurable`. A thread with no readable `setup` (older games) gets `record === null`: the board stays locked, the status says "View only.", the opponent card shows "Unknown", and a "View only" banner suggests starting a new game.

### Command ids make resends idempotent

Every human command gets a message id from `createCommandIds()` in `src/commands.ts`, keyed by `commandKey(ply, content)`, which produces `"<ply>:<content>"`. The key deliberately leaves out the thread id, because a new game's first command is sent before the server assigns one. The id memo lives for the lifetime of the hook, which is one game, since the table remounts for a new game. The same command at the same position always reuses the same id, and a different key gets a new `crypto.randomUUID()`. The server treats a message id it has already consumed as a no-op, so re-sending a command can't play a move twice. Do not mint a fresh id for an existing key.

The `Table` wraps every action in `issue()`. It clears the dismissed notice and any earlier submit error. It swallows the SDK's "a run is already in flight" rejection (`isBusyRejection`), because the first command's answer is already on its way. Any other submit failure is shown.

### Table state, locking and errors

The board is locked in any of these cases:

- the game has no record, or has not finished loading (`restore !== "ready"`),
- you are viewing an earlier ply,
- a run is loading,
- the game is over,
- a turn is pending,
- an optimistic move is in flight.

Stepping back through plies (`BoardControls`, `usePlyKeys`, clicking the move list) replays from `startFen`. A move that arrives meanwhile leaves you where you are until you go back to the end.

Errors come from these places:

- `values.error` is a move rejection recorded in graph state. It appears as a dismissible "Move rejected" banner and comes back on the next command.
- `stream.error` and submit failures appear as an `ErrorMessage`.
- Auth failures show a "LangSmith API key needed" banner that links to Settings. `isAuthError` (`src/format.ts`) detects them from HTTP status 401/403, or from SDK request messages that *start* with `HTTP 401/403`, `Protocol request failed: 401/403` or `Thread state request failed: 401/403`. The match is anchored so that a failed run's message, such as a model provider's 401, isn't mistaken for the browser's key being refused.
- Load failures show the `failed` / `missing` banners described above.

### New game dialog and settings

With no game on screen, the New game dialog *is* the page: it can't be closed, and it has no close or Cancel button. The overlay state lets you open Settings from the dialog and return to it with your unsaved picks (`draft`) intact.

The dialog edits a `Setup`: side (White, Black or Random), System 1 model or none, LLM preset, custom spec or none, and the Advanced knobs. `matchupOf(setup, summarize)` turns a setup into a `ChessContext`:

- The policy is `hybrid` when both a System 1 model and an LLM are chosen, `systemone` or `llm` when only one is chosen.
- Choosing neither is not playable. Neither is an empty custom spec.
- If an LLM is chosen with memory `summarize`, the matchup is blocked while the model's limit is being checked (`checking`) and when the check couldn't be made (`unknown`, which comes with a Retry button). A model with no known limit (`no`) has `summarize` downgraded to `none` (`memoryOf`).
- The model the policy doesn't use is still filled with its default, because the field is required (`src/setup.ts`).

Number fields in Advanced settings whose text isn't a valid value also block Play ("Fix the Advanced settings marked invalid"). Advanced settings only show the sections that matter for the chosen matchup. Gate and shortlist knobs appear only for hybrid. After a game starts, the opponent card lists the knobs that differ from the defaults (`changedKnobs`) and shows the thread id.

**Model limit.** The dialog asks the server for the chosen LLM's input limit through `GET /ui/model-limit?model=…` (`src/modelLimit.ts`), sending `x-api-key` when a key is set. It waits 300 ms (`LIMIT_DELAY_MS`) so typing a custom spec doesn't flood the server. The answer is one of three kinds. `known` means the limit is a number. `none` means `max_input_tokens` is `null`: the model has no known limit or can't be built. `failed` covers a non-OK response, a malformed body or a network error, and says nothing about the model. These map to `summarize` values `yes`, `no` and `unknown`. The Summarize memory option is disabled only for `no`. An answer that arrives for a model that is no longer selected is dropped, and a changed API key asks again.

Pressing Play does two things:

1. It checks the API key. `checkApiKey` POSTs `{limit: 1}` to `/assistants/search` with `x-api-key` when a key is set. Any status other than 401/403 counts as ok. A 401/403 means `missing` if no key was sent and `rejected` if one was. A network error means `unreachable`. Because `langgraph dev` accepts anything, an empty key only counts as missing when the server says so (`src/auth.ts`). A failed check shows a banner with an "Open settings" action.
2. If the key is ok, and the picks on screen are still the ones Play was pressed for and still playable, it saves the setup, resolves a Random side once (the game keeps that colour), and seats the game with that side and context as `chosen`.

If the dialog unmounts while the check is running (cancelled, or sent to Settings), a late answer does nothing. If the picks were edited during the check, the answer doesn't start a game and you have to press Play again.

The API key is the only app-level setting. It is stored under `langchain-chess:app` and sent as `apiKey` to `useStream`.

**Where the settings schema comes from.** The server exposes `GET /ui/config`, which returns `{ graph, schema, defaults }` built from the Python `ChessContext` (`app.py`). The current web client does not fetch it. The knob types, ranges and defaults are hand-mirrored in `packages/chess-ui/src/types.ts` (`ChessContext`, `DEFAULT_CONTEXT`, and `setup` on `ChessValues`) and `apps/web/src/settings.ts` (`CONTEXT_CHECKS`). The header of `types.ts` says to keep them in step with the Python by hand. If you add a context field, update all three places. Note that `recordedContext` rejects a recorded `setup` missing any key, so a new field that the client knows about but that older threads never recorded makes those threads view-only.

### Persistence is untrusted

localStorage holds only two things (`src/storage.ts`): the last New game setup (`langchain-chess:setup`) and the app settings (`langchain-chess:app`). A game's own setup lives in its thread. Every reader accepts missing, old or corrupt entries, and also blocked storage:

- `browserStorage()` returns `null` when reading `localStorage` throws or every call on it throws. Writers report whether the write landed. When storage is blocked, or a save fails, `App` shows a "This browser isn't saving" banner.
- `sanitizeSetup` falls back field by field. Its knobs go through `sanitizeContext`, which keeps only known knobs with valid values, so obsolete storage can't reach a run. Each failing knob falls back to its own default, and the removed memory value `full` is mapped to `summarize`.
- The old global `langchain-chess:settings` blob, which held both the key and a context, is read only while the newer keys are absent. `loadSetup` maps its context onto the pickers (`setupFromContext`). `loadAppSettings` copies its key into `langchain-chess:app`.

## packages/chess-ui: shared source, not a built library

`@langchain-chess/chess-ui` is private, and its `exports` point directly at TypeScript source: `.` is `./src/index.ts`, and there are also `./styles.css` and `./testing` (`packages/chess-ui/package.json`). The package has no build step. Each app compiles it as part of its own Vite build, through the `workspace:*` dependency. Because of this:

- Each app's Tailwind `content` globs include `../../packages/chess-ui/src/**` (`apps/web/tailwind.config.cjs`), so utility classes used in the shared components get generated.
- Each app imports `@langchain-chess/chess-ui/styles.css` next to the Macaw stylesheet (`apps/web/src/index.css`).
- React and React DOM are peer dependencies, so there is exactly one React.

What the package provides (`src/index.ts`):

- **Types** (`types.ts`): hand-written TypeScript copies of the Python state and context. They include `ChessValues`, which lists the only thread channels a UI may read (`messages`, `start_fen`, `moves`, `plies`, `turns`, `outcome`, `error`, and `setup`, which older games don't have). State-API private channels must never be read. They also include `Ply`, `TurnRecord`, `Outcome`, `SystemOneMeta`, `ChessContext`/`DEFAULT_CONTEXT`, and `Quality` for graded moves.
- **Chess helpers** (`chess.ts`): `replay` and `positions` rebuild positions and stop quietly at the first move chess.js rejects, because the server is the authority. `tryMove` is the client-side legality check on drag, and the graph validates the move again on the server. The file also has `isPromotion`, `sideToMove`, `opposite`, `isFen` and `fenOrStart`.
- **Selectors** (`selectors.ts`): pure reads over thread values. They are `lastPolicyPly`, `turnOf`, `isPending`, `liveAnalysis`, `systemOneMeta` (reads the `SystemOneMiddleware` ply meta), and `turnCost`, which mirrors the Python pricing and makes a move cost its whole turn.
- **Components**: `Board` (drag or click-to-move, with a promotion picker; it reads the current position through a ref so a drag can't land after the board locked or moved on), `BoardControls`, `MoveList` (optionally shows a per-ply `quality`), `PlyDetails`, `Analysis` (lazy Markdown), and the keyboard hook `usePlyKeys`.
- **`./testing`**: fixture builders (`call`, `turn`, plies) for tests.

## apps/review: reading graded games in LangSmith

`apps/review` runs inside LangSmith's custom-app sandbox. It is a library build that produces one CommonJS `dist/bundle.js` with everything inlined:

- Code splitting is off, because the sandbox can't load chunks.
- `process.env.NODE_ENV` is defined as `"production"` (except under Vitest), because the sandbox has no `process` (`apps/review/vite.config.ts`).

The sandbox calls the exported `render(data, container, metadata)` on every host update. The entry creates the root, the inline stylesheet and the app's dependencies (`api`, `openUrl`) once, and re-renders in place. A new `api` would re-run the App's loads and reset the chosen project. It follows the host's light or dark mode (`src/entry.tsx`, `HostTheme`). Its only connection to the outside is `window.langsmith.call` and `openUrl` (`src/global.d.ts`). Tests inject `call` through `createApi(call)`.

Data flow (`src/api.ts`):

1. `GET /api/v1/sessions` lists projects. The default pick is `langchain-chess-app`, then any project whose name contains `chess`, then the most recent.
2. `POST /api/v2/threads/query` returns a page of 20 threads for the chosen project and time window (1, 7, 30 or 90 days). Paging uses a cursor.
3. For each thread's `last_trace_id`, two requests run in parallel:
   - `POST /api/v2/runs/query` fetches the root runs with metadata and outputs, bounded by `min_start_time` to avoid heavier rate limits.
   - `GET /api/v1/feedback` fetches feedback with key `game_review`.
4. `toGame` (`src/games.ts`) joins them. `values` comes from `decodeValues` (`src/values.ts`). The project picker lists every project, so outputs can be anything. The last run's outputs count as a game record only if they validate: `moves` must be a UCI array, and the optional `start_fen`, `plies`, `turns` and `outcome` must have the shapes the view draws. Otherwise the game shows "No game record". The matchup label is derived from run metadata (`policy`, `model`, `systemone_model`).

`reviewsByRun` (`src/review.ts`) considers a feedback item only if its key is `game_review`, its `feedback_source.metadata.grader` is `"lcchess grade"`, and it has a `run_id`. Other feedback under the same key is ignored. `parseReview` then turns the value into a `Grading`:

- `graded` for a complete version-1 `GameReview`: engine, numeric settings, per-side accuracy, well-formed `evals` and per-ply grades, and exactly one eval per position.
- `invalid`, with the first problem found, otherwise.

`toGame` also marks a graded review `invalid` when its plies don't match the game's moves, so evaluations are never drawn against a different move sequence. `App` tags each loaded page with its `project|since` query, so a stale response is never shown for a new query. A "load more" is owned by the same query, so a new query cancels it instead of racing it.

`GameView` renders the game with the shared components:

- It rebuilds FENs for every position (`positions`) and marks move-list entries with each ply's `quality`.
- It draws the played move as an arrow, plus the engine's `best_move` when that differs.
- With a graded review, it shows an eval bar (`evals[index]`, one per position including the start), a `GradeCard`, and an `EvalGraph`. Win percentages mirror the Python `win_percent`, clamped at ±1000 cp.
- With an `invalid` review, it shows a "Review unreadable" banner that suggests `lcchess grade --thread <id> --force`. Without a review, it shows a hint to run `lcchess grade --thread <id>`.
- "Open trace" opens the graded ply's run (or the thread's last run) by resolving its URL on the server (`GET /api/v2/runs/{id}/url`), so the host and workspace are correct on any deployment.

How reviews are produced is covered in [Grading and review](/openwiki/workflows/grading-and-review.md).

## Vite+ workspace conventions

- **Tooling.** Every package uses Vite+ (`vp`): `vp dev`, `vp build`, `vp test --run --coverage`. At the root, `vp check`, `vp run -r test` and `vp run -r build` run across the workspace (`package.json`). The review app's `dev` script is `langsmith apps dev`.
- **One version per shared dependency.** `pnpm-workspace.yaml` pins shared dependencies in a `catalog`, including `vite` aliased to `@voidzero-dev/vite-plus-core`. Every package refers to them as `catalog:`, so the apps and chess-ui can't drift. An override forces every `vite@*` to the catalog version.
- **Lint and format.** These are configured only in the root `vite.config.ts`, because Vite+ ignores `lint`/`fmt` blocks in nested configs. Oxlint runs with the react, typescript and oxc plugins, type-aware with type checking. Rules include `react/rules-of-hooks` and `vite-plus/prefer-vite-plus-imports`, which is why tests import `vi` from `vite-plus/test`. Formatting skips `apps/server`, `libs`, and `openwiki/**`.
- **Tests.** Each app runs jsdom Vitest over `tests/**/*.test.{ts,tsx}` with a **100% coverage threshold** on lines, functions, branches and statements. The review app writes coverage outside its own directory, because `langsmith apps push` uploads the directory without reading `.gitignore`. Most web tests replace `useStream` with a shared fake (`apps/web/tests/support/fakeStream.ts`). The fake records every option set, supports per-thread overrides so tests can hold two games apart, and exposes `hydrationPromise` and `getThread` so load outcomes can be simulated. `useGame.sdk.test.tsx` runs the real SDK over a stubbed `fetch` to pin how it settles a thread load. `App` takes injectable `random`, `checkKey` and `modelLimit`, so tests are deterministic and need no server. Focused suites include `useGame.test.tsx`, `commands.test.ts`, `storage.test.ts`, `setup.test.ts`, `settings.test.ts`, `modelLimit.test.ts` and `auth.test.ts`. The review app has `logic.test.ts`, `components.test.tsx`, `App.test.tsx` and `entry.test.tsx`. See [Testing conventions](/openwiki/testing/testing-conventions.md).
