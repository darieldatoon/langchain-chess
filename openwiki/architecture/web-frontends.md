---
type: architecture overview
title: Web frontends
description: How the React play UI (apps/web) gates on a sign-in session, then drives the chess graph through useStream on a session-authenticated SDK client with one thread per game, starts games from any position, continues any game from the setup recorded in its thread, and exports settings and PGN; how its render.html page draws positions-dataset runs inside LangSmith over postMessage; how the LangSmith review app (apps/review) reads and launches game grading; and how both share packages/chess-ui, including the settings schema generated from the Python ChessContext, inside a Vite+ pnpm workspace.
tags: [frontend, react, web-ui, review-app, chess-ui, vite-plus, useStream, game-setup, output-renderer, settings-schema, sign-in]
sources:
  - id: openwiki-source-5f219f204b3e870beec929d9
    resource: repo://.github/workflows/pages.yml
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
  - id: openwiki-source-9e73cfc78a8aeac72fc36a15
    resource: repo://apps/server/langchain_chess_server/codegen.py
  - id: openwiki-source-88d085345a1ecd09c61f7ab0
    resource: repo://apps/server/langchain_chess_server/game_setup.py
  - id: openwiki-source-c9b903d37e22daedc4499a4b
    resource: repo://apps/server/langchain_chess_server/graph.py
  - id: openwiki-source-bae425afdb2f1082f5506562
    resource: repo://apps/server/tests/test_codegen.py
  - id: openwiki-source-50b51378a1829867080b74e7
    resource: repo://apps/web/render-preview.html
  - id: openwiki-source-b1e87ca2444d206bfbfe7860
    resource: repo://apps/web/render.html
  - id: openwiki-source-1b589132a05fcfdecd7cc1d4
    resource: repo://apps/web/src/App.tsx
  - id: openwiki-source-fde4d91838391ae51474c06b
    resource: repo://apps/web/src/auth/check.ts
  - id: openwiki-source-fe293e29941663c7d6f751f0
    resource: repo://apps/web/src/auth/config.ts
  - id: openwiki-source-958c86b14cece0555a5ab2c3
    resource: repo://apps/web/src/auth/session.ts
  - id: openwiki-source-bcef43de392e407e18431d20
    resource: repo://apps/web/src/auth/stored.ts
  - id: openwiki-source-080933253640cf8c93f7692b
    resource: repo://apps/web/src/auth/useSession.ts
  - id: openwiki-source-6c16a0bf13a1dee1d6a311ca
    resource: repo://apps/web/src/commands.ts
  - id: openwiki-source-69320542b148a0b7ce9830b7
    resource: repo://apps/web/src/components/AdvancedSettings.tsx
  - id: openwiki-source-a064a9145a09969774ce0485
    resource: repo://apps/web/src/components/AppSettingsDialog.tsx
  - id: openwiki-source-679cdb48778b3623b39d7a96
    resource: repo://apps/web/src/components/GameActions.tsx
  - id: openwiki-source-122f779bf6eb18ae91667e7f
    resource: repo://apps/web/src/components/NewGameDialog.tsx
  - id: openwiki-source-014fc9fe685ac48f04242f4f
    resource: repo://apps/web/src/export.ts
  - id: openwiki-source-4f011d0e79f0e3b4e0d2c231
    resource: repo://apps/web/src/files.ts
  - id: openwiki-source-63a59ecdfb2c0567127b7b6f
    resource: repo://apps/web/src/format.ts
  - id: openwiki-source-f78d0b7d64a02f657382652c
    resource: repo://apps/web/src/index.css
  - id: openwiki-source-8e8b395281c4996e784ae3b5
    resource: repo://apps/web/src/main.tsx
  - id: openwiki-source-7f2e3520a656d432bb97cc86
    resource: repo://apps/web/src/modelFacts.ts
  - id: openwiki-source-317427f883fe1e61687ad02b
    resource: repo://apps/web/src/render/main.tsx
  - id: openwiki-source-c6c15d388ec06a704bad47a2
    resource: repo://apps/web/src/render/messages.ts
  - id: openwiki-source-3de79666167cc43811e06b73
    resource: repo://apps/web/src/render/Render.tsx
  - id: openwiki-source-9077010ec7881a1179710a83
    resource: repo://apps/web/src/render/RenderApp.tsx
  - id: openwiki-source-19a42ef883802736914257fc
    resource: repo://apps/web/src/render/useParentMessage.ts
  - id: openwiki-source-f2887a22b7d95aeb9307ea2d
    resource: repo://apps/web/src/Root.tsx
  - id: openwiki-source-3cb426dd15d324cb1ef8679d
    resource: repo://apps/web/src/settings.ts
  - id: openwiki-source-be4a82601d4a0ee9e1634703
    resource: repo://apps/web/src/setup.ts
  - id: openwiki-source-1076e2fa932ac0d1c637b001
    resource: repo://apps/web/src/storage.ts
  - id: openwiki-source-b4f2241e9aa3978bf00a2fd9
    resource: repo://apps/web/src/Table.tsx
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
  - id: openwiki-source-8c34ce929a30f9c9e247c7fc
    resource: repo://evals/langchain_chess_evals/positions/upload.py
  - id: openwiki-source-72b5d686f860ea86c8592080
    resource: repo://mise.toml
  - id: openwiki-source-0c21b06ab993756e943b973e
    resource: repo://packages/chess-ui/package.json
  - id: openwiki-source-52f19ad58ec6882226bc4a43
    resource: repo://packages/chess-ui/src/chess.ts
  - id: openwiki-source-b6047122232d689643d18ad5
    resource: repo://packages/chess-ui/src/generated/settings.ts
  - id: openwiki-source-15a1d3b1618239efaf01080e
    resource: repo://packages/chess-ui/src/selectors.ts
  - id: openwiki-source-c81a61ad418f9c19c518d61d
    resource: repo://packages/chess-ui/src/settings.ts
  - id: openwiki-source-fd0e9360c0eb5b2cec5ea440
    resource: repo://packages/chess-ui/src/types.ts
  - id: openwiki-source-11c3d2c3935232cdb4b6a81f
    resource: repo://packages/chess-ui/tests/settings.test.ts
  - id: openwiki-source-40275cb92c3610938f16ade3
    resource: repo://pnpm-workspace.yaml
  - id: openwiki-source-5e1b077422a94ae165e88e4e
    resource: repo://vite.config.ts
generated: { by: "openwiki/0.6.0", at: "2026-11-01T03:07:46.931Z" }
verified:
  - by: openwiki/0.6.0
    at: 2026-11-01T03:07:46.931Z
---

# Web Frontends

The JavaScript side of the repository is a pnpm workspace. Its frontend packages are `apps/web`, `apps/review` and `packages/chess-ui`; the workspace also contains `evals/reports` (`pnpm-workspace.yaml`).

- `apps/web` is the play UI. Its build also produces `render.html`, a LangSmith custom output renderer for the positions dataset.
- `apps/review` is a LangSmith custom app for looking at graded games and starting new grading jobs.
- `packages/chess-ui` holds the board, move list, layout shell, types, selectors, PGN/opening helpers and the settings model that both apps use.

None of them import Python. The play UI reaches the agent over the Agent Server HTTP API, signed in with LangSmith or an API key (see [LangSmith sign-in](/openwiki/integrations/langsmith-sign-in.md)). The renderer fetches nothing: it only reads messages that LangSmith posts to it. The review app only talks to the LangSmith API. For the server side of that boundary, see [Agent Server integration](/openwiki/integrations/agent-server.md). For the thread values the UIs read, see [State record](/openwiki/concepts/state-record.md). For the settings themselves, see [Settings and model arguments](/openwiki/concepts/settings-and-model-arguments.md).

```mermaid
flowchart LR
  subgraph Workspace["pnpm workspace (Vite+)"]
    Web["apps/web"]
    Render["apps/web render.html"]
    Review["apps/review"]
    UI["packages/chess-ui (TS source)"]
  end
  Web -->|"useStream on graph chess, session headers"| AS["Agent Server"]
  Web -->|"GET /ui/model, POST /assistants/search"| AS
  Web -->|"OAuth sign-in"| LSO["LangSmith sign-in"]
  Pages["GitHub Pages or server /ui/"] -->|"serves the build"| Web
  LSR["LangSmith dataset view"] -->|"postMessage in iframe"| Render
  Review -->|"window.langsmith.call"| LS["LangSmith API"]
  Web --> UI
  Render --> UI
  Review --> UI
```
*The apps, the shared package, and the one remote system each one talks to.*

## apps/web: the play UI

### Entry and served location

`src/main.tsx` mounts `Root` inside `StrictMode`, `AppThemeProvider` and `TooltipProvider`. There are two build inputs: `index.html` (the play UI) and `render.html` (the output renderer, see [below](#renderhtml-the-langsmith-output-renderer)).

The bundle is built for one of two homes (`apps/web/vite.config.ts`):

- **GitHub Pages (the deployment).** `.github/workflows/pages.yml` builds with `BASE_PATH=/<repo>/`, `OUT_DIR=dist`, `VITE_API_URL` set to the agent deployment's URL, and the sign-in variables `VITE_OAUTH_CLIENT_ID`, `VITE_LANGSMITH_ORGANIZATION_ID` and `VITE_LANGSMITH_SSO_SLUG` (left unset, the build offers API keys only), and publishes `apps/web/dist`. The workflow is skipped until `VITE_API_URL` is configured. It runs CI on the current tip of `main` first, holds a queueing concurrency lock so publishes go out in push order, and a re-run build skips itself when a newer commit changed the UI and a newer run will publish it.
- **The Python server (local runs and e2e tests).** By default the build uses `base: "/ui/"` and writes into `apps/server/langchain_chess_server/static`. `apps/server/langchain_chess_server/app.py` mounts that directory at `/ui` when it exists and redirects `/ui` to `/ui/`. It mounts under `/ui` rather than `/` because `/` is the server's health check. When no build exists (as in the deployment), `/ui/` returns a 404 that tells you to run `mise run build` or `vp dev`, while `/ui/config` and `/ui/model` still answer.

`apiUrl()` in `src/settings.ts` decides where the API is:

1. If `VITE_API_URL` is set, it uses that (the Pages build).
2. Otherwise, under `vp dev`, it uses `http://localhost:2024` (`langgraph dev`).
3. Otherwise it uses `window.location.origin`, since the local server serves the UI from the same origin.

The build splits vendor code into long-lived chunks (react, langchain, chessboard, ui). Vite's preload helper gets a chunk of its own, because otherwise it lands in the langchain chunk and `render.html`, which needs no LangChain code, would download all of it. There is deliberately no catch-all vendor group, so the lazily loaded Markdown chunk stays separate.

### Root: sign-in first, then App with a session

`Root` (`src/Root.tsx`) decides whether the page may play at all. It reads the build's sign-in configuration (`langsmithAppConfig`): a client id without an organization id shows a "This build is misconfigured" banner and nothing else. Otherwise `useSession` resolves the tab's `Session` and `Root` renders by its status:

- `checking`: an empty, busy page.
- `signed-out`: the `SignIn` screen (Sign in with LangSmith when the build has an OAuth app, or an API key that is checked against the server before it is kept), with the reason it opened, such as an expired sign-in.
- `signed-in`: `App` with that `session` and an `onSignOut` callback.

A `Session` (`src/auth/session.ts`) is one of three kinds: `none` (the server takes no credential, as with `langgraph dev` or a local server), `apiKey` (a LangSmith API key kept in `sessionStorage` for this tab only), or `oauth` (an email and an `accessToken()` function, called per request because access tokens last five minutes). `sessionHeaders` turns it into `x-api-key` or `Authorization: Bearer …`. `useSession` resumes in order: a LangSmith sign-in, this tab's API key, else `none` if the server accepts an unauthenticated `/assistants/search`. The OAuth flow, the organization check and the stored account are described in [LangSmith sign-in](/openwiki/integrations/langsmith-sign-in.md).

Everything below `Root` takes the session as a value: `App` passes it to every `Table`, the key check, the model-facts request and the Settings dialog. Signing out returns to the sign-in screen, which unmounts `App`.

### App, seats and the Table

`App` (`src/App.tsx`) owns the page-level state: the last setup, reply-card view (`TurnView`) and display preferences, the current `Seat`, and an `Overlay` (New game dialog, Settings, or none). It computes the board layout from the container size (`layoutFor`/`allocate` from chess-ui) and renders either a `Table` for the seat or, before any game, an `EmptyTable` behind the dialog. Off phones, the header shows the signed-in email for a LangSmith session.

A `Seat` (`src/Table.tsx`) has a `number`, an `autoStart` flag and `chosen`, a `GameRecord` (`side`, `context`, `startFen`) or `null`. The `Table` is keyed by the seat number, so a new number remounts it and its `useGame`:

- **Opened from a link.** If the URL has `?thread=`, the first seat is `{ number: 0, autoStart: false, chosen: null }`, and no dialog opens; the game's setup comes from the thread.
- **New game.** Play clears the URL thread, resolves a Random side once (`resolveSide`), and creates a seat with the next number and `chosen = { side, context, startFen }`. `autoStart` is set when the opponent is to move in the starting position (`sideToMove(startFen) !== side`), so for the standard position that means the human plays Black.
- **Rematch.** Clears the URL thread and seats the opposite side with the same context and starting position.
- **Reload.** A new seat number on the same thread (the URL still names it), with `autoStart` off.

On mount, a table whose seat has `autoStart` sends `start` once. A ref guards that effect, because StrictMode runs mount effects twice.

### useGame: one useStream, one thread, one game

`useGame(session, chosen)` in `src/useGame.ts` is the only connection to the agent. It builds one SDK `Client` per session with `sessionClient(apiUrl(), session)` and opens one `useStream<ChessValues>` from `@langchain/react` with that `client`, `assistantId: "chess"` and the current `threadId`. The client sets `apiKey: null` (so the SDK never looks for a key in the environment) and adds the session's headers, freshly computed, to every request and stream through `onRequest`; an OAuth session therefore asks for a current access token on each request. `chosen` is used only until the thread records its own setup. Everything the page renders is derived from `stream.values`:

- `startFen` comes from `startFenOf(values, chosen)`: the thread's `start_fen` once the server has accepted the root (any turn exists, `rootAccepted`), else the new game's pick. `start_fen` alone proves nothing, because a rejected first command still writes the standard one.
- It replays `startFen` plus `moves` with chess.js (`replay` from chess-ui) to get the board FEN, the FEN after every move, and fallback SANs.
- It builds move-list entries from `plies`, falling back to SAN and then UCI. Moves without a ply are labelled `external`.
- `record` is the game's side, context and start, from `gameOf(values, chosen)` (see [Continuing a game from its thread](#continuing-a-game-from-its-threads-setup-record)); `policy` is the record's policy.
- `reply` drives the reply card. While a run is streaming, or while the last turn is still `pending`, it is `pending` (activity `running` or `stopped`) with the open turn (or an in-flight stand-in), System 1's live decision (`liveSystemOne`), and `liveAnalysis`: the newest AI text after the current turn opened, skipping messages that already committed a ply, so the previous move's analysis never shows up as live. A commit that lands before the run stops loading shows at once. Otherwise it is the last ply whose source isn't `external` (`lastPolicyPly`) with its turn and the FEN it was chosen from.
- `pendingTurn` is true when the last turn record has status `pending` (`isPending`), and `drawOffers` reads `draw_offers` (absent on older games).
- `restore` says whether the thread has loaded (see below).

Every submit goes through one `send` helper. It passes `config: { configurable, run_name: "chess-web", tags: ["web"] }`, `metadata: { surface: "web" }` and `multitaskStrategy: "reject"`. `configurable` comes from `configurableOf(record.context)`: the settings `version` first, then every setting key in order, and nothing else. The same object is what an exported settings file contains. When there is no record, `DEFAULT_CONTEXT` stands in, but in that case the board stays locked, so the stand-in never reaches a run.

The hook exposes these actions:

| Action | What it sends | When the UI offers it |
|---|---|---|
| `play(uci, fenAfter)` | a human message whose content is the UCI move | when you drop a piece on an unlocked board |
| `start()` | a human message `go` | "Start" / "Ask opponent to move": opponent to move, no pending turn |
| `retry()` | empty input `{}`, which resumes the pending turn | "Retry": a run failed mid-turn (pending turn) |
| `resign(side)` / `offerDraw(side)` | a human message `resign <side>` / `draw <side>` | the Resign (with an in-place confirm) and Offer draw buttons |

A fresh `go` would be rejected while a turn is pending, so after a failure the only way forward is an empty submit. `play` is optimistic: it stores a `pendingMove` (UCI and FEN after the move) and the board shows it until the submit settles, whether it succeeds or fails. Resign and draw carry the human's side because the server doesn't know which side is human; a draw offer shows as `sending: "draw"` while in flight and "Draw declined." once answered.

**Games from another position.** When a new game's `startFen` isn't the standard one and the root isn't accepted yet, its first command is a single `position` input (`{ start_fen }` for `start`, `{ start_fen, moves: [uci] }` for `play`), never a message, because the server rejects both together. The hook keeps this first packet (and the human's move, shown on the board meanwhile) until the root is accepted or the game ends. `retry` resends exactly that packet while it is unanswered (`firstUnanswered`), because the server keys it by its fingerprint. If the response carries an `error` and no turn, the root was refused (`startRejected`), and the "Move rejected" banner offers "Change position", which reopens the dialog with that FEN filled in.

### Thread in the URL and loading

A game is a thread, and the page records the thread in the `?thread=` query parameter. `threadFromUrl` reads it when the hook mounts, and `writeThreadToUrl` updates it with `history.replaceState`, so no history entries are added. When `useStream` reports a new thread id through `onThreadId`, the hook binds it in state and writes it into the URL. This happens only while the hook is still mounted. A replaced game's stream can report its id late, and that report must not rebind the page. The browser stores nothing per game: the game's settings live in the thread itself.

A game from the URL can only be played once it has loaded. `restore` tracks each load by the SDK's `hydrationPromise`:

- `loading` while `isThreadLoading`,
- `missing` when a load for a thread id settles cleanly but binds no thread (the SDK settles a 404 that way),
- `failed` when the load rejects,
- `ready` otherwise.

A superseded load that settles late can't overwrite the current one's outcome. A new session (a new sign-in) creates a new client, which loads the thread again with a new hydration promise. The `Table` shows a "Couldn't load this game" banner with a Reload button for `failed`, and a "This game isn't on the server" banner for `missing`.

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

Any client can continue a game from its thread alone, because the server records the game's settings in the thread. `GameSetupMiddleware` (`apps/server/langchain_chess_server/game_setup.py`), which `build_graph` adds to every run's graph (`graph.py`), adds a public `setup` channel to the graph state. It writes the run's resolved `ChessContext` (every key of its version) into `setup` only in the run that opened the game's first turn, and never again. It does this both before and after the agent, so the record exists even when the first turn fails or ends the game. Later runs still play with whatever context they send, but `setup` keeps naming the first turn's settings. A thread created before `setup` existed never gets one. The middleware state marks `setup` as `OmitFromInput`, so a client can't write it.

On the client, `ChessValues.setup` mirrors that channel as `unknown`, and `gameOf(values, chosen)` in `src/setup.ts` produces the game's `GameRecord`:

- **Context.** It uses `recordedContext(values.setup)`, which wraps chess-ui's `loadRecorded`. This is strict: the record needs a valid `version` and exactly the keys of that version, each valid, or it counts as damaged. A context patched with defaults would play a different game. A record from an older settings version is migrated to the current one (version 2 only added keys whose defaults play as version 1 did; version 3 maps retired `semif-*` System 1 models to the new default). When there is no valid record, it falls back to `chosen.context`, which covers a new game before its first turn is recorded. If neither exists, the record is `null`.
- **Start.** `startFenOf`, as above.
- **Human side** (`humanSideOf`). The human plays the `external` moves, so the side of the last external ply decides. Before any external ply, the human is the opposite of whoever played ply 0. Before any move at all, it is the picked side, or else the side *not* to move in the starting position, because the opponent's first turn is still open.

```mermaid
flowchart TD
  A["values.setup"] --> B{"loadRecorded accepts it?"}
  B -->|yes| C["context = recorded setup, migrated"]
  B -->|no| D{"chosen from dialog?"}
  D -->|yes| E["context = chosen.context"]
  D -->|no| F["record = null: view only"]
  C --> G["side from plies, else picked side, else side not to move"]
  E --> G
  G --> H["GameRecord pins configurable for every run"]
```
*How the web UI decides which setup a thread is played with.*

So opening a link `?thread=<id>` creates a seat with `chosen: null`. Once the thread loads, its `setup` supplies the opponent and knobs, and its plies supply the human's colour. Every later command sends exactly that context as `configurable`. A thread with no readable `setup` (older games, or a damaged record) gets `record === null`: the board stays locked, the opponent card shows "Unknown", and a "View only" banner suggests starting a new game.

### Command ids make resends idempotent

Every human command gets a message id from `createCommandIds()` in `src/commands.ts`, keyed by `commandKey(ply, content)`, which produces `"<ply>:<content>"`. The key deliberately leaves out the thread id, because a new game's first command is sent before the server assigns one. The id memo lives for the lifetime of the hook, which is one game, since the table remounts for a new game. The same command at the same position always reuses the same id, and a different key gets a new `crypto.randomUUID()`. The server treats a message id it has already consumed as a no-op, so re-sending a command can't play a move twice. Do not mint a fresh id for an existing key. Resign and draw commands are never resent automatically: a consumed id resent while a turn is pending would retry that turn.

The `Table` wraps every action in `issue()`. It clears the dismissed notice and any earlier submit error. It swallows the SDK's "a run is already in flight" rejection (`isBusyRejection`), because the first command's answer is already on its way. Any other submit failure is shown.

### Table state, locking and errors

The board is locked in any of these cases:

- the game has no record, or has not finished loading (`restore !== "ready"`),
- you are viewing an earlier ply,
- a run or thread load is in progress (`isLoading`),
- the game is over,
- a turn is pending,
- an optimistic move (or a first packet's move) is in flight.

Stepping back through plies (`BoardControls`, the keyboard via `useGameKeys`, the mouse wheel when enabled, clicking the move list) goes through chess-ui's `usePlyCursor` and shows the FENs `useGame` already replayed; `BackToLive` returns to the end. The table also shows the opening reached (`useOpenings`, `openingAt`), puts "Your turn" in the tab title when your move arrives while the tab is hidden (`src/title.ts`), and on phones swaps the side cards for a move strip, a one-line reply and Reply/Opponent tabs (chess-ui's `GameShell`). The opponent card shows `opponentLabel`, the knobs that differ from the defaults (`changedKnobs`) and the thread id.

Errors come from these places:

- `values.error` is a move rejection recorded in graph state. It appears as a dismissible "Move rejected" banner and comes back on the next command. A "the game is over" refusal of a resent first packet after the game ended is not shown.
- `stream.error` and submit failures appear as an `ErrorMessage`; a stopped pending turn also shows that error on the reply card.
- Auth failures show a "Sign-in needed" banner ("Sign out in Settings and sign in again") with an "Open settings" action. `isAuthError` (`src/format.ts`) detects them from HTTP status 401/403, or from SDK request messages that *start* with `HTTP 401/403`, `Protocol request failed: 401/403` or `Thread state request failed: 401/403`. The match is anchored so that a failed run's message, such as a model provider's 401, isn't mistaken for the browser's sign-in being refused.
- Load failures show the `failed` / `missing` banners described above.

### Game export: FEN, PGN and Lichess

The board menu's Export section copies the shown position's FEN or the game's PGN, downloads the PGN as `langchain-chess-<thread>.pgn` (`pgnFileName`), or opens the game on Lichess (`lichessUrl`, which falls back to the position alone when the game is too long to send). `pgnOf` (`src/export.ts`) builds the PGN: player names are "You" and the opponent label (or the colours for a game without a record), the date comes from the first turn's first call, and the comment lists the opponent, changed knobs and thread id. When the browser refuses clipboard access, an `ExportDialog` shows the text to copy by hand. The game-over card offers Rematch, New game and "Analyze on Lichess".

### New game dialog and settings

With no game on screen, the New game dialog *is* the page: it can't be closed and has no Cancel button (`canCancel` is false). The overlay state lets you open Settings from the dialog's More menu, or from a key-problem banner, and return to it with your unsaved picks (`draft`) and typed starting position intact. The header's gear button (or the phone menu) opens Settings directly.

The dialog edits a `Setup`: side (White, Black or Random), System 1 model or none (a model from elsewhere, such as an imported file, is kept under its own name), LLM preset, custom spec or none, and the Advanced knobs. It also has a **Starting position** field: empty means the standard position; otherwise the text is checked with chess-ui's `validateStart`, normalized (`normalizeFen`) and previewed on a small locked board. The starting position is never stored with the setup. `matchupOf(setup, summarize, takesEffort)` turns a setup into a `ChessContext`:

- The policy is `hybrid` when both a System 1 model and an LLM are chosen, `systemone` or `llm` when only one is chosen.
- Choosing neither is not playable. Neither is an empty custom spec, nor `model_kwargs` that the server would hold back (`modelKwargsProblems(..., "server")`) when an LLM plays.
- **Reasoning effort.** When an LLM would be sent an effort (`sentEffort`), the matchup is blocked while the server is being asked whether the model takes one (`checking`), and blocked with "remove it from Model arguments" when the model takes none but `model_kwargs` sets one. A model that takes none gets `reasoning_effort: null` (`effortOf`), and the Reasoning Effort select is disabled.
- **Memory** is a boolean; its "Summarize" option means on. If an LLM is chosen with memory on, the matchup is blocked while the model's limit is being checked (`checking`) and when the check couldn't be made (`unknown`, which comes with a Retry button). A model with no known limit (`no`) has memory turned off (`memoryOf`).
- The model the policy doesn't use is still filled with its default, because the field is required.

Number fields and the model-arguments JSON field in Advanced settings keep their own text; while that text isn't a valid value, Play is blocked ("Fix the Advanced settings marked invalid"); an invalid starting position blocks it too ("Fix the starting position."). Advanced settings only show the sections that matter for the chosen matchup; gate and shortlist knobs appear only for hybrid. Collapsed, Advanced shows a one-line summary (side, opponent, number of changed settings). Each setting's label and tooltip come from the generated `SETTING_LABELS` and `SETTING_HELP`.

**Model facts.** The dialog asks the server about the chosen LLM through `GET /ui/model?model=…` (`fetchModelFacts` in `src/modelFacts.ts`), sending the session's headers (`sessionHeaders`). It waits 300 ms (`LIMIT_DELAY_MS`) so typing a custom spec doesn't flood the server. The server answers `{ max_input_tokens, takes_effort }` (`app.py`). A reply with a number or `null` limit and a boolean `takes_effort` is `known`; a non-OK response, a malformed body or a network error is `failed`, which says nothing about the model. The limit maps to `summarize`: a number is `yes`, `null` (no known limit, or the model can't be built) is `no`, and `failed` is `unknown`; a failed request counts as taking an effort, since the server checks again. The Summarize memory option is disabled only for `no`. An answer that arrives for a model that is no longer selected is dropped, Retry asks again, and a new session asks again (`App` keeps the facts function stable per session).

Pressing Play does two things:

1. It checks the sign-in. `checkAccess` (`src/auth/check.ts`) POSTs `{limit: 1}` to `/assistants/search` with the session's headers. Any status other than 401/403 counts as ok. A 401/403 means `missing` for a `none` session and `rejected` otherwise (carrying the server's `detail` when it gives one). A network error means `unreachable`. Because `langgraph dev` accepts anything, no credential only counts as missing when the server says so. A failed check shows a banner from `keyCheckMessage` ("Sign-in needed", "Sign-in refused" or "Server unreachable") with an "Open settings" action that keeps the draft. The same check backs the sign-in screen's API-key form and the session resume.
2. If the check is ok, and the picks and starting position on screen are still the ones Play was pressed for and still playable, `App` saves the setup, resolves a Random side once (the game keeps that colour), and seats the game with that side, context and start as `chosen`.

If the dialog unmounts while the check is running (cancelled, or sent to Settings), a late answer does nothing. If the picks were edited during the check, the answer doesn't start a game and you have to press Play again.

The Settings dialog (`AppSettingsDialog`) holds no editable setting any more: it describes the current session ("This server needs no sign-in.", "Signed in with a LangSmith API key. It stays in this tab only." or "Signed in with LangSmith as <email>.") and offers Sign out for any session other than `none`. The opponent is chosen per game in the New game dialog.

### Settings import and export files

An opponent's settings can leave and enter the app as a JSON file, through the dialog's More menu (`src/files.ts` is the imperative edge; the parsing is pure):

- **Export.** Enabled only while the matchup is playable, it downloads `opponent.json` containing `configurableOf(context)`. So an exported file is exactly what a run sends as `configurable`: `version` first, then every setting.
- **Import.** Opens a file picker. `readJson` rejects a file that isn't JSON ("That file isn't JSON."). `importedSetup(data, side)` then runs chess-ui's `loadSettings`: the file needs a `version` no newer than the app's, may set any subset of settings, rejects unknown keys and invalid values, and is resolved over the defaults. A valid file replaces the pickers and knobs (`setupOf`) but keeps the side you picked, and remounts Advanced so its text fields show the imported values. A failure shows "Couldn't import that setup" with the `SettingsError` message. A read that finishes after the dialog unmounted is dropped.

The same file format is what the Python side loads (see [Settings and model arguments](/openwiki/concepts/settings-and-model-arguments.md)).

### Persistence is untrusted

localStorage holds three things for the game UI (`src/storage.ts`): the last New game setup (`langchain-chess:setup`), which reply-card sections are open (`langchain-chess:view`), and display preferences such as board scale, material, mistake notes, wheel stepping and the tab-title alert (`langchain-chess:display`). A game's own setup and starting position live in its thread. Credentials are not here: an API key lives in `sessionStorage` (`langchain-chess:api-key`), localStorage keeps only the last LangSmith account's email (`langchain-chess:last-account`), and the session resume deletes the key older versions kept under `langchain-chess:app` (`src/auth/stored.ts`). Every reader accepts missing, old or corrupt entries, and also blocked storage:

- `browserStorage()` returns `null` when reading `localStorage` throws or every call on it throws. Writers report whether the write landed. When storage is blocked, or a save fails, `App` shows a "This browser isn't saving" banner.
- A stored setup carries the settings `version` its knobs are in (`storedSetup`). `sanitizeSetup` treats a setup without a version as the defaults, and otherwise falls back field by field. Its knobs go through `sanitizeContext`, which migrates them from their version dropping unknown keys, then keeps each valid value on its own and gives each failing one its default. If the version itself can't be read, no stored knob is trusted. So obsolete storage can't reach a run.
- The view toggles and display preferences fall back to their defaults one by one (chess-ui's `sanitizeTurnView` and `sanitizeDisplayPrefs`).

## render.html: the LangSmith output renderer

`render.html` mounts `src/render/main.tsx`, a separate small React app that LangSmith embeds in an iframe as the positions dataset's custom output renderer. It is served next to the play UI (`/ui/render.html` from the local server); `lcchess-evals positions upload --renderer-url <https URL>` writes its URL into the dataset's `iframe_config`, which must be an absolute `https://` URL (`evals/langchain_chess_evals/positions/upload.py`). See [System 1 evals](/openwiki/workflows/system-one-evals.md) for the dataset.

**Protocol.** LangSmith posts each run's outputs, or the example's reference outputs, as `{type: "output" | "reference", data, metadata: {inputs}}`. `useParentMessage` (`src/render/useParentMessage.ts`) listens for `message` events and keeps the latest one it can read. It accepts a message only when the page is embedded (`window.parent !== window`) and the event's `source` is the embedding window. It deliberately checks the source window rather than an origin, because self-hosted LangSmith can live on any origin; the embedded check matters because a top-level page is its own parent.

**Parsing.** `readMessage` (`src/render/messages.ts`) is pure. It returns `null` for anything that isn't an `output` or `reference` message, so the page ignores other traffic. Otherwise it returns one of:

- `reference`: the position plus Stockfish's `evals` (per move, centipawns or mate from White's side) and `ranked` (every legal move, best first; every ranked move needs an eval).
- `output`: the position plus System 1's ranking, either `ranked` moves with `confidence`, `margin`, `tournament`, `requests` and `latency_ms`, or a `failed` ranking carrying the run's `error`.
- `unreadable`, with the first reason found.

The position comes from `metadata.inputs` (`start_fen`, `moves`, `legal`): the start FEN must be valid and every move must replay legally, or the message is unreadable. These shapes mirror the evals dataset schema and System 1's eval target outputs.

**Views.** `Render` draws a locked chess-ui `Board` from the mover's side with the top three moves as arrows, and next to it either a Stockfish table of every move with its eval (`evalText` shows it from the mover's side, such as `+0.4` or `mate in 3`), or System 1's top five moves as `MoveBar`s (with "Show all") plus confidence, margin, tournament, requests and latency. A failed ranking shows a "Ranking failed" banner; an unreadable message shows "Not a chess position". Before any message it says it is waiting for LangSmith, or, when opened on its own, how to set it as the renderer. LangSmith sends no theme, so the page follows the system's colour scheme and never the play UI's stored choice (`storageKey={null}`).

`render-preview.html` is a dev-only page (`vp dev`, then `/ui/render-preview.html`) that embeds the renderer several times and posts sample messages from `preview/samples.ts`. It is not a build input, so it never deploys. The same samples drive `tests/render/messages.test.ts`.

```mermaid
sequenceDiagram
  participant LS as LangSmith page
  participant P as useParentMessage
  participant M as readMessage
  participant R as Render
  LS->>P: postMessage type output or reference
  P->>P: embedded and source is parent?
  P->>M: event.data
  M-->>P: reference, output, unreadable or null
  P->>R: latest readable message
  R-->>LS: board, arrows and move table in the iframe
```
*How a LangSmith run reaches the renderer's board.*

## packages/chess-ui: shared source, not a built library

`@langchain-chess/chess-ui` is private, and its `exports` point directly at TypeScript source: `.` is `./src/index.ts`, and there are also `./styles.css` and `./testing` (`packages/chess-ui/package.json`). The package has no build step. Each app compiles it as part of its own Vite build, through the `workspace:*` dependency. Because of this:

- Each app's Tailwind `content` globs include `../../packages/chess-ui/src/**` (`apps/web/tailwind.config.cjs`, which also lists `index.html` and `render.html`), so utility classes used in the shared components get generated.
- Each app imports `@langchain-chess/chess-ui/styles.css` next to the Macaw stylesheet (`apps/web/src/index.css`).
- React and React DOM are peer dependencies, so there is exactly one React.

What the package provides (`src/index.ts`):

- **Generated settings** (`generated/settings.ts`): `mise run generate:settings` runs `langchain_chess_server.codegen`, which writes the settings' TypeScript and JSON Schemas (`settings.schema.json`, `opponent.schema.json`) from the Python `ChessContext` in `libs/systemone`. The TypeScript holds `SETTINGS_VERSION` (currently 3), the `ChessContext` interface with each setting's description, `SETTING_SPECS` (type, enum values, ranges, nullability), `SETTING_LABELS` and `SETTING_HELP` for the web form, `DEFAULT_CONTEXT`, the frozen `VERSION_DEFAULTS` of every version, and `MODEL_KWARGS_RULES`. Do not edit it by hand: a server test (`apps/server/tests/test_codegen.py`) fails when the committed files are stale, and the formatter skips the directory.
- **Settings logic** (`settings.ts`): a hand-written mirror of `libs/systemone/langchain_chess_systemone/settings.py`. `isSetting` checks a value against its spec (and `model_kwargs` against the local rules), `migrateSettings` carries a partial set of settings to the current version (1→2 adds keys, 2→3 retires `semif-*` System 1 models), `loadSettings` reads a settings file, `loadRecorded` reads a game's recorded setup, and `modelKwargsProblems`, `heldBack` and `sentEffort` mirror the Python model-argument rules. Its tests run the shared cases in `libs/systemone/tests/fixtures/settings-cases.json`, so the TypeScript and Python loaders give the same answers. The web app's `CONTEXT_CHECKS` is derived from the generated specs through `isSetting`, so no setting range is hand-copied.
- **Types** (`types.ts`): hand-written TypeScript copies of the Python state, which its header says to keep in step by hand. They include `ChessValues`, which lists the only thread channels a UI may read: `messages`, `start_fen`, `moves`, `plies`, `turns`, `outcome`, `error`, and the optional `draw_offers`, `setup` and `systemone_live`, which older games don't have. State-API private channels must never be read. They also include `PositionInput` (the input-only `position` command), `Ply`, `TurnRecord`, `Outcome` (checkmate, draw, or resignation including an `illegal_moves` forfeit), `DrawOffer`, `SystemOneMeta`, `SystemOneLive`, `ReplyState`, `TurnView`, and `Quality`/`Eval` for graded moves.
- **Chess helpers** (`chess.ts`): `replay` rebuilds positions and stops quietly at the first move chess.js rejects, because the server is the authority; from a rejected move on, the position stays put. `tryMove` is the client-side legality check on drag, and the graph validates the move again on the server. The file also has `isPromotion`, `sideToMove`, `opposite`, `isFen`, `fenOrStart`, `sanAt` and start-position validation.
- **Selectors** (`selectors.ts`): pure reads over thread values. They are `lastPolicyPly`, `turnOf`, `isPending`, `rootAccepted` (any turn exists), `liveAnalysis`, `systemOneMeta` (reads the `SystemOneMiddleware` ply meta), `drawMarks`, and `turnCost`, which mirrors the Python pricing and makes a move cost its whole turn.
- **Other pure modules**: reply and stage building (`stages.ts`, `recordedPolicy`), PGN (`toPgn`, `lichessUrl`), openings (`openingAt`, lazily loaded table), material, display preferences, layout sizing (`layoutFor`, `allocate`).
- **Components and hooks**: `Board` (drag or click-to-move, with a promotion picker and optional arrows; it reads the current position through a ref so a drag can't land after the board locked or moved on), `GameShell`, `PlayerStrip`, `BoardControls`, `BackToLive`, `BoardMenu`, `DisplayMenu`, `ExportMenu`, `MoveList`/`MoveStrip` (optionally showing a per-ply `quality`), `MoveBar`, `PlyDetails`, `Analysis` (lazy Markdown), `ResponsiveDialog`, `ShortcutDialog`, `usePlyCursor` and `useGameKeys`.
- **`./testing`**: fixture builders (`call`, `turn`, plies) for tests.

The server still exposes `GET /ui/config`, which returns `{ graph, schema, defaults }` built from the Python `ChessContext` (`app.py`), but no frontend fetches it: the frontends compile the generated schema in instead. To add a setting, change the Python `ChessContext`, run `mise run generate:settings`, and update the shared cases and any web form section. Note that `loadRecorded` rejects a recorded `setup` that lacks a key of its version, so a record is only readable if its version's key set matches.

## apps/review: reading and grading games in LangSmith

`apps/review` runs inside LangSmith's custom-app sandbox. It is a library build that produces one CommonJS `dist/bundle.js` with everything inlined:

- Code splitting is off, because the sandbox can't load chunks.
- `process.env.NODE_ENV` is defined as `"production"` (except under Vitest), because the sandbox has no `process` (`apps/review/vite.config.ts`).

The sandbox calls the exported `render(data, container, metadata)` on every host update. The entry creates the root, the inline stylesheet and the app's dependencies (`api`, `openUrl`) once, and re-renders in place. A new `api` would re-run the App's loads and reset the chosen project. It follows the host's light or dark mode (`src/entry.tsx`, `HostTheme`). Its only connection to the outside is `window.langsmith.call` and `openUrl` (`src/global.d.ts`). Tests inject `call` through `createApi(call)`. The sandbox has no localStorage, so view and display preferences last only the session.

Data flow (`src/api.ts`):

1. `GET /api/v1/sessions` (name containing `langchain-chess-`) lists projects, keeping only the agent's tracing projects in order: `langchain-chess-production`, then `langchain-chess-local`. The first is the default pick.
2. `POST /api/v2/threads/query` returns a page of 20 threads for the chosen project and time window (1, 7, 30 or 90 days). Paging uses a cursor; a page appended by "load more" skips games already listed.
3. For the threads' `last_trace_id`s, three requests run in parallel:
   - `POST /api/v2/runs/query` fetches the root runs with metadata and outputs, bounded by `min_start_time` to avoid heavier rate limits.
   - `GET /api/v1/feedback` fetches feedback with keys `game_review` and `grade_status`, and separately `game_review_part`, each paged 100 at a time (headers are listed apart from parts so a regrade deleting rows between pages can't shift a header past the offset).
4. `toGame` (`src/games.ts`) joins them. `values` comes from `decodeValues` (`src/values.ts`): the last run's outputs count as a game record only if they validate — `moves` must be a UCI array, and the optional `start_fen`, `plies`, `turns`, `outcome`, `draw_offers` and `systemone_live` must have the shapes the view draws. Otherwise the game shows "No game record". The matchup label is derived from run metadata (`policy`, `model`, `systemone_model`), and `surface` (such as `web`) labels the human side.

`reviewsByRun` (`src/review.ts`) considers a feedback item only if its `feedback_source.metadata.grader` is `"lcchess grade"` and it has a `run_id`; other feedback under the same keys is ignored. Per run, the newest `game_review` item is the review header (a regrade publishes its header before deleting the last one), and `game_review_part` items are its parts. `readReview` then turns them into a `Grading`:

- A `null` value is `invalid` (LangSmith stores a value over its size cap as null).
- A version 2 header is joined with the parts of its `generation` into a version-1 shape: every part must be present, contiguous and consistent, and the plies must add up to the header's count; otherwise it is `invalid` with the reason.
- `parseReview` marks it `graded` for a complete version-1 `GameReview` — engine, numeric settings, per-side accuracy, well-formed `evals` and per-ply grades (with engine `lines`), and exactly one eval per position — and `invalid`, with the first problem found, otherwise.

`toGame` also marks a graded review `invalid` when its plies don't match the game's moves, so evaluations are never drawn against a different move sequence. `App` tags each loaded page with its `project|since` query, so a stale response is never shown for a new query. A "load more" is owned by the same query, so a new query cancels it instead of racing it. Refresh reloads every page on screen in place (`firstPages`), fetching further pages until the open game is among them, so the list and the open game stay up meanwhile.

**Analyze.** The review app can also start grading (`src/analysis.ts`). The Analyze button writes a `grade_status` feedback mark with value `analyzing` (grader `lcchess grade`) on the game's last run, creates a sandbox named after the thread from the `langchain-chess-grader` snapshot with an explicit, limited set of delegated permissions, waits for it to be ready, and launches `lcchess grade --project … --thread … --workers 4 [--force] --sandbox-job` detached inside it. It then lets go: the job replaces the game's feedback, settles or clears the mark, and deletes its sandbox. If the launch fails, the mark and any sandbox are removed and a readable reason is shown (sandboxes not enabled, missing snapshot, sandbox limit, already running, role not allowed). The sandbox name is per thread, so a second start on the same game conflicts instead of running twice. `marksByRun` reads this grader's newest mark per run; an `analyzing` mark older than 10 minutes counts as `stalled`, and a `failed` mark carries the job's log. Retrying a failed or stalled job first deletes the old sandbox and mark. How the grading itself works is in [Grading and review](/openwiki/workflows/grading-and-review.md).

`GameView` renders the game with the shared components:

- It rebuilds FENs for every position (`replay`), looks ply records up by their own `ply` (`recordsByPly`) and marks move-list entries with each ply's `quality` and the eval after it.
- It draws the played move as an arrow (in the negative colour for a mistake or blunder), plus the engine's `best_move` when that differs.
- With a graded review, it shows an eval bar (`evals[index]`, one per position including the start), an `EngineHeader` and the engine `EngineLines` before the move (which can be previewed on the board), a `Summary`, per-side accuracy on the player strips, and an `EvalGraph` in the Graph tab, next to Agent latency and Export tabs. Win percentages mirror the Python `win_percent`, clamped at ±1000 cp.
- `AnalysisBanner` shows where the game stands: "Analyzing…" while a job runs, "Analysis didn't finish" for a stalled one and "Analysis failed" with its log (both with Retry), "Analysis couldn't start" for a failed launch, "Review unreadable" for an `invalid` review (Re-analyze, or `lcchess grade --project … --thread <id> --force`), and "Not graded yet" with an Analyze button (or the `lcchess grade` command) for an ungraded game.
- "Open trace" opens the graded ply's run (or the thread's last run) by resolving its URL on the server (`GET /api/v2/runs/{id}/url`) and turning it into the thread view's link, so the host and workspace are correct on any deployment.

## Vite+ workspace conventions

- **Tooling.** Every package uses Vite+ (`vp`): `vp dev`, `vp build`, `vp test --run --coverage`. At the root, `vp check`, `vp run -r test` and `vp run -r build` run across the workspace (`package.json`). The review app's `dev` script is `langsmith apps dev`.
- **One version per shared dependency.** `pnpm-workspace.yaml` pins shared dependencies in a `catalog`, including `vite` aliased to `@voidzero-dev/vite-plus-core`. Every package refers to them as `catalog:`, so the apps and chess-ui can't drift. An override forces every `vite@*` to the catalog version.
- **Lint and format.** These are configured only in the root `vite.config.ts`, because Vite+ ignores `lint`/`fmt` blocks in nested configs. Oxlint runs with the react, typescript and oxc plugins, type-aware with type checking. Rules include `react/rules-of-hooks` and `vite-plus/prefer-vite-plus-imports`, which is why tests import `vi` from `vite-plus/test`. Formatting skips `apps/server`, `libs`, the Python parts of `evals`, `openwiki/**`, and the generated `packages/chess-ui/src/generated/**`, which a test compares byte for byte.
- **Tests.** Each app runs jsdom Vitest over `tests/**/*.test.{ts,tsx}` with a **100% coverage threshold** on lines, functions, branches and statements. The review app writes coverage outside its own directory, because `langsmith apps push` uploads the directory without reading `.gitignore`. Most web tests replace `useStream` with a shared fake (`apps/web/tests/support/fakeStream.ts`). The fake records every option set, supports per-thread overrides so tests can hold two games apart, and exposes `hydrationPromise` and `getThread` so load outcomes can be simulated. `useGame.sdk.test.tsx` runs the real SDK over a stubbed `fetch` to pin how it settles a thread load. `App` takes a `session` plus injectable `random`, `checkKey(session)` and `modelFacts(session, model)`, and `Root` takes injectable `config`, `signIn`, `check` and storages, so tests are deterministic and need neither a server nor LangSmith. Focused suites include `useGame.test.tsx`, `App.test.tsx`, `commands.test.ts`, `storage.test.ts`, `setup.test.ts`, `settings.test.ts`, `files.test.ts`, `export.test.ts`, `modelFacts.test.ts`, `format.test.ts`, `Root.test.tsx`, `main.test.tsx`, the sign-in suites under `tests/auth/` (`session`, `check`, `config`, `oauth`, `stored`, `useSession`, `SignIn`), `title.test.ts`, the dialog and component suites under `tests/components/`, and the renderer's `tests/render/` suites. chess-ui's `settings.test.ts` runs the shared Python settings cases. The review app has `logic.test.ts`, `analysis.test.ts`, `components.test.tsx`, `App.test.tsx` and `entry.test.tsx`. See [Testing conventions](/openwiki/testing/testing-conventions.md).
testing/testing-conventions.md).
ttings.test.ts` runs the shared Python settings cases. The review app has `logic.test.ts`, `analysis.test.ts`, `components.test.tsx`, `App.test.tsx` and `entry.test.tsx`. See [Testing conventions](/openwiki/testing/testing-conventions.md).
gic.test.ts`, `analysis.test.ts`, `components.test.tsx`, `App.test.tsx` and `entry.test.tsx`. See [Testing conventions](/openwiki/testing/testing-conventions.md).
