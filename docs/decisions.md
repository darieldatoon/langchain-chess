# Decisions and measurements

Choices that look like gaps, and the numbers behind them. Revisit when the conditions change.

## Prompt caching (Anthropic): shipped without

The gateway's Responses route (which the `langsmith:` provider uses) supports only one
request-level breakpoint, and it lands on the per-turn position, so it never hits. Caching would
need `ChatAnthropic` on the gateway's native `/anthropic` route plus a breakpoint before the
position.

Measured prompts are small: about 520 input tokens per move with `memory="none"` (the default),
most of it the per-turn position, so the cacheable prefix is under Opus 5's 512-token minimum.
The since-removed `full` memory mode measured about 1,000 (at most 1,850) over 12-ply games. At
$5 per million input tokens, caching would save under half a cent a move. Revisit if long
`summarize` games become the norm. OpenAI models cache automatically.

## Memory and analysis length

Three self-play hybrid games per mode (12 plies, low effort, 2026-09-25): the LLM's analysis
averaged 97 characters with `memory="none"` and 213 with the since-removed `full` mode, so
seeing earlier bare `MOVE:` turns didn't make it terser. System 1 played no moves in the `full`
games of that sample, so the imitation risk from System 1's bare turns is still unmeasured.
