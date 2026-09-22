# jev-chess UI

React front end for the `game` graph, built with Vite+ (`vp`) and `@langchain/react`.

- `vp dev` runs it on http://localhost:5173 against `langgraph dev` on :2024 (override with
  `VITE_API_URL`).
- `vp check` formats, lints, and type-checks. `vp test --run --coverage` gates at 100%.
- `vp build` writes into `../src/jev_chess/server/static`, which the Agent Server serves at
  `/ui` (see `src/jev_chess/server/app.py`). CI does this right before `langgraph deploy`.

Against a deployed server the UI asks for a LangSmith API key (Settings). It stays in this
browser's localStorage and is sent as `X-Api-Key`; nothing else about auth is custom.
