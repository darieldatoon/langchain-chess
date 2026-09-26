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

- Do not document secrets, key values or the contents of `.env`. Name the variables only.
- From LangSmith traces, report patterns (latency, failure modes, call counts per turn), not
  individual games, thread ids or error text that quotes model output.

## Decisions and measurements

This brief is the source of record for these decisions. Write them up on their own page,
`/openwiki/concepts/decisions.md`, cite this brief as the evidence, and link to that page
rather than restating the numbers elsewhere.

Choices that look like gaps, and the numbers behind them. Revisit when the conditions change.

### Prompt caching (Anthropic): shipped without

The gateway's Responses route (which the `langsmith:` provider uses) supports only one
request-level breakpoint, and it lands on the per-turn position, so it never hits. Caching would
need `ChatAnthropic` on the gateway's native `/anthropic` route plus a breakpoint before the
position.

Measured prompts are small: about 520 input tokens per move with `memory="none"` (the default),
most of it the per-turn position, so the cacheable prefix is under Opus 5's 512-token minimum.
The since-removed `full` memory mode measured about 1,000 (at most 1,850) over 12-ply games. At
$5 per million input tokens, caching would save under half a cent a move. Revisit if long
`summarize` games become the norm. OpenAI models cache automatically.

### Memory and analysis length

Three self-play hybrid games per mode (12 plies, low effort, 2026-09-25): the LLM's analysis
averaged 97 characters with `memory="none"` and 213 with the since-removed `full` mode, so
seeing earlier bare `MOVE:` turns didn't make it terser. System 1 played no moves in the `full`
games of that sample, so the imitation risk from System 1's bare turns is still unmeasured.
