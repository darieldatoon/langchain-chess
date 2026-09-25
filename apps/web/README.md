# langchain-chess web UI

React front end for the `chess` graph (`create_chess_agent`), built with Vite+ (`vp`),
`@langchain/react`, and the LangChain Macaw design system (`@langchain/macaw-components` +
Tailwind v3 preset).

- `vp dev` runs it on http://localhost:5173 against `langgraph dev` on :2024 (override with
  `VITE_API_URL`).
- `vp check` formats, lints, and type-checks. `vp test --run --coverage` gates at 100%.
- `vp build` writes into `../server/langchain_chess_server/static`, which the Agent Server serves
  at `/ui` (see `apps/server/langchain_chess_server/app.py`). CI does this right before
  `langgraph deploy`.

One thread is one game; its id stays in the URL (`?thread=`). Moves are human chat messages
whose content is the UCI move (`go` asks the opponent to open), each with a stable id so a
resend is a no-op; an empty submit retries a pending turn. The UI reads only `start_fen`,
`moves`, `plies`, `turns`, `outcome`, `error`, and `messages`; `src/types.ts` mirrors the Python
state by hand.

A game starts from the New game dialog (it opens by itself when the URL has no thread): play as
White, Black, or Random, pick a System 1 and an LLM (both set is `hybrid`, one alone is
`systemone` or `llm`), and tune the rest under Advanced. `src/setup.ts` turns that setup into a
`ChessContext`. On Play the game pins its resolved side and context in localStorage
(`langchain-chess:game:<thread>`), and every submit for that thread sends that context as
`configurable`, so a later setup never changes a game in progress. Playing Black sends `go` by
itself; Rematch swaps colours and keeps the context. The last setup is remembered
(`langchain-chess:setup`).

Styling follows Macaw's rules: semantic Tailwind classes (`bg-surface-level-2`,
`text-secondary`, `gap-space-4`) from the preset, Macaw components for controls, and no raw
colours. The chessboard is the one exception: react-chessboard takes style objects, so it
reads the same semantic tokens as CSS variables. `pnpm exec macaw search <capability>` finds
components; `pnpm exec macaw inspect <Name>` shows their props and stories.

Against a deployed server the UI needs a LangSmith API key (the gear, Settings). It stays in this
browser's localStorage (`langchain-chess:app`) and is sent as `X-Api-Key`; nothing else about
auth is custom. The UI only asks for it when the server answers 401 or 403.
