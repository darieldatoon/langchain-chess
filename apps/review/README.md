# langchain-chess review app

A [LangSmith custom app](https://docs.langchain.com/langsmith/custom-apps) that replays each game
in a tracing project as an analysis board: an eval bar and graph, a quality mark on every move,
arrows for the move played and the engine's best move, who played each move (System 1, the LLM,
forced, or the human) with its reasoning, and a link to the move's trace.

Grades come from `lcchess grade` (see the repository README), which writes them to the traces as
feedback. The app only reads.

```sh
mise run dev:review    # the app in a local LangSmith sandbox, rebuilt on save
mise run review:size   # build, then check what `langsmith apps push` would upload
cd apps/review && langsmith apps push --name langchain-chess-review   # first push creates the app
```

- **Publishing.** Pushes to `main` publish the app (`.github/workflows/deploy.yml`) once the
  `CUSTOM_APP_ID` repository variable is set. The first push above creates the app and writes its
  id to `.langsmith/app.json`, which is gitignored: copy the `app_id` into the variable. CI writes
  the file from the variable, since the CLI reads the id from nowhere else. The deploy key
  (`LANGSMITH_API_KEY`) must be able to manage custom apps in the workspace.
- **Data.** Games are threads (`POST /api/v2/threads/query`). Each page reads the threads' last
  root runs (their outputs hold the game record) and the grader's `game_review` feedback on them,
  in one call each. `game_review` carries every eval, every move's grade and the run that played
  it, so replaying a game reads nothing more.
- **Sandbox.** The build is one CommonJS file, `dist/bundle.js`, exporting
  `render(data, root, metadata)`. It can reach only the LangSmith API, through
  `window.langsmith.call`, and navigates with `window.langsmith.openUrl`. The theme follows
  `metadata.mode`; there is no localStorage.
- **Size.** Push uploads this whole directory as text, `.gitignore` or not: 5 MiB and 500 files at
  most. Library mode inlines every font, so `postcss.config.cjs` keeps only the latin woff2 faces
  (2.5 MB of bundle down to 1.1 MB), and test coverage is written outside the app. CI runs
  `review:size`.
- **Rebuilds.** The source depends on `packages/chess-ui` through `workspace:*`, so only a checkout
  of this repo can build it: `langsmith apps pull` and LangSmith's in-browser editor can't. Push
  from the repo.
- **Plans.** Plus plans get one custom app per org.
