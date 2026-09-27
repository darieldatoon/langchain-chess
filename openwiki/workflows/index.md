# Files

- [Grading and review](grading-and-review.md) - How `lcchess grade` selects game threads from LangSmith, rebuilds each game from its root runs, evaluates every distinct position once on a pool of UCI engines, grades moves the Lichess way, and writes fingerprinted feedback; how the review app replays it and launches grading jobs in a LangSmith sandbox built from the grader snapshot.
- [System 1 evals: positions dataset, experiments and reports](system-one-evals.md) - How the unpublished evals workspace member builds and uploads the Lichess+Stockfish positions dataset, runs System 1 experiments in LangSmith through a GatewayRanker target, scores rows and summaries (gate table, calibration), and records results as static TSX reports and a board renderer.
