# evals

Datasets and LangSmith experiments for langchain-chess. A uv workspace member that is never
published: nothing imports it, and changing it never redeploys the agent.

| Path | What it is |
|---|---|
| `langchain_chess_evals/positions/` | The labelled positions dataset. Knows nothing about System 1; any move-choice eval can reuse it. |
| `langchain_chess_evals/systemone/` | System 1 experiments over that dataset: target, row scores, summary metrics. |
| `datasets/positions/vN.jsonl` | The committed dataset, one LangSmith example per line, and `vN.manifest.json` beside it. |
| `experiments/systemone-baseline.toml` | The baseline grid. An entry names System 1 with `model` and `style`, or with `opponent`: an opponent settings file, next to the eval-only controls such as `max_options`. |
| `experiments/opponents/` | Opponent settings files the grid references. |
| `reports/` | Dated, static HTML reports of experiments, written in TSX. See [its README](reports/README.md). |
| `.cache/` (gitignored) | Lichess downloads, the resumable label cache, local copies of run summaries. |

## The positions dataset

`langchain-chess-positions` holds 2,200 positions from real rated Lichess games (rapid and
classical only), labelled by Stockfish at depth 16 with a line for **every legal move**.

- **Source:** one pinned month of the [Lichess games database](https://database.lichess.org/)
  (CC0), checked against Lichess's sha256. Positions come from games, not the eval dump, so each
  example carries the real move number and the recent moves System 1 sees in play.
- **Sampling:** up to 2 positions per game from ply 10, deduped by FEN, with equal quotas per
  rating band (of the side to move) and phase. Seeded, so a month and a seed always give the
  same rows.
- **Splits:** `dev` (40 per band, 200 in all) for quick passes, and `full` (400 per band,
  2,000 in all).
- **Inputs** are `RankRequest`'s shape: `{start_fen, moves, legal}`. **Reference outputs** are
  the eval of every legal move, the engine's order (`ranked`), the best move and the top 3.
  Read the order from `ranked`, never from `evals`: LangSmith returns object keys sorted. **Metadata** has the game URL,
  both ratings, the band, phase, time control, ply, legal move count, `tactic`, and the move
  the human played (`played_move`).

The dataset carries JSON Schemas for its inputs and outputs
([`positions/schema.py`](langchain_chess_evals/positions/schema.py)), with a description of each
field, and LangSmith rejects any example that breaks them. `upload` creates the dataset with
them. It stops if an existing dataset has other schemas: changing them makes LangSmith re-check
every stored example in one request, which fails on a full dataset, so delete that dataset (its
experiments go with it) or upload under another `--dataset`. Metadata has no schema in LangSmith.

The manifest records the source months and their sha256, the filters, quotas and seed, the
engine and its settings, the git SHA, and counts per split, band and phase. A new build is a new
version (`v2`), never an edit of `v1`.

## Run it

```sh
mise run eval:positions:upload                                      # the committed JSONL into your LangSmith workspace, tagged v1
mise run eval:systemone -- --model typesafe/jev-latest --style rich # one experiment on the dev split
mise run eval:systemone -- --model typesafe/jev-latest --split full
mise run eval:systemone -- --opponent experiments/opponents/jev-terse.json
mise run eval:systemone:baseline                                    # the four baseline runs on full
```

`upload` and the experiments need `LANGSMITH_API_KEY` in `.env`, and the experiments need the
gateway key too (see the [root README](../README.md#before-you-start)). Experiments run with
`max_concurrency=4`: the old harness hit gateway 429s at 8.

Rebuilding the dataset is a one-off, and slow: a 6 GB download, then about 1 to 3 minutes of
Stockfish per position per core, because every legal move gets its own line.

```sh
mise run eval:positions:build -- --version v2 --month 2018-06   # --help for every option
```

It stops if the pinned month leaves a bucket short, after reading up to `--max-months` months.
Labels are cached as they finish, so an interrupted build resumes.

## See outputs as a board

LangSmith shows an experiment's outputs as JSON. The web UI's GitHub Pages site also serves a
[custom output renderer](https://docs.langchain.com/langsmith/custom-output-rendering) that draws
them on a board: Stockfish's best move and top 3 as arrows with every move's eval, and System 1's
picks as arrows with probability bars, confidence, margin and its tournament. It shows in
experiment runs, the compare view and annotation queues, not the dataset's Examples tab.

Point the dataset at the site's copy, or your own fork's:

```sh
mise run eval:positions:upload -- --renderer-url https://darieldatoon.github.io/langchain-chess/render.html
```

`upload` merges the setting into the dataset's metadata (`iframe_config`) and rejects anything
but an absolute `https://` URL, which is all LangSmith will embed. There is no default: without
the flag, `upload` leaves the setting as it is. Turn it off in LangSmith (⋮ → Custom Output
Rendering). To work on the renderer locally, see [apps/web](../apps/web/README.md#the-langsmith-renderer).

## What an experiment measures

The target calls `GatewayRanker(model, style=..., max_options=...).arank(...)` on the example,
as `SystemOneMiddleware` would. A ranking that fails after retries scores as a miss.

**Row scores:** `recall@{1,3,5,8}` (Stockfish's best move in System 1's top k),
`top3_in_top5`, `human_match@1`, `cp_loss` (capped at 1,000) and `win_pct_loss` of System 1's
top move, `finalist_recall` and `finalist_top3` (tournament rows only: did the heats keep
Stockfish's best, or any of its top 3), and `requests`, `latency_ms`, `input_tokens`, `error`.

**Summary metrics**, keyed `metric|group`: every row score for `all` rows, by band, by phase,
and by legal move count (`legal<=16`, a single ranking; `legal>16`, a tournament for a model capped at 16). For
`all` and each legal-count group, also the gate table (share of moves kept and top-1 accuracy
at margin and confidence thresholds 0.5 to 0.95) and confidence and margin calibration by
decile.

Means are plain means over the stratified set: every band and phase weighs the same, not as
often as it occurs on Lichess.

After a tournament only the finalists come back, so recall@k counts a move knocked out in the
heats as a miss. The capped Jev run in the baseline forces a 16-option tournament onto
Jev, so comparing it with plain Jev rich shows what the tournament alone costs.

## Tests

`mise run test` covers this package at 100%, with fakes for Stockfish, Lichess and LangSmith.
`mise run test:live` includes one real Jev ranking through the target.
