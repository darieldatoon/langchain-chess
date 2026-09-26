# OpenWiki brief for langchain-chess

Write for a coding agent about to change this repo. It knows LangChain and chess, not this
codebase. Explain how the pieces fit and which rules a change must keep, not what each file
contains line by line.

## Prioritise

1. **Package map and dependency direction.**
   - Python: `libs/systemone` depends on `libs/chess`; `libs/cli` and `apps/server` depend on
     both. Nothing depends on `libs/cli` or `apps/server`.
   - JavaScript: `apps/web` and `apps/review` share `packages/chess-ui`, consumed as TypeScript
     source. They reach the agent over HTTP only.
   - Show which layer a new feature belongs in.
2. **The middleware contract.** `ChessMiddleware`, the write guard and what each state key
   may do (`allowed_moves` only narrows, one `proposal` per turn, `candidates` are soft), why
   `before_model` must be idempotent, and the frozen per-turn decision that a retry replays.
3. **System 1.** How `SystemOneMiddleware` ranks legal moves, the `margin` and `confidence`
   gates and their thresholds, the SemIf tournament for more than 16 options, and what happens
   when ranking fails with and without an LLM behind it.
4. **The state record clients may read**: `start_fen`, `moves`, `plies`, `turns`, `outcome`,
   `error`. Explain why `messages` and the private channels are not part of it, and how one
   run plays at most one turn on one thread per game.
5. **Model specs, the LLM Gateway and cost.** `init_chat_model` specs, the `langsmith:`
   provider, how the recorder captures and prices every provider response locally, and when a
   turn's cost is incomplete.
6. **Adapters.** The Agent Server graph and the `/ui` mount, the UCI engine, the terminal UI
   and `lcchess grade` with the review app.
7. **Deployment and the image build.** The uv workspace in `langgraph.json`, why
   `dockerfile_lines` lists every member's `pyproject.toml`, and why workspace sources live
   only in the root `pyproject.toml`.
8. **Testing conventions.** 100% line and branch coverage on both halves, fakes over mocks,
   and live tests that are opt-in (`-m live`) and cost money.

## Keep out

- Measured decisions are recorded in the README's "Decisions and measurements" section. Link
  to it rather than restating the numbers, which change.
- Do not document secrets, key values or the contents of `.env`. Name the variables only.
- From LangSmith traces, report patterns (latency, failure modes, call counts per turn), not
  individual games, thread ids or error text that quotes model output.
