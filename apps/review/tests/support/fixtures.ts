import { START_FEN, type ChessValues, type Quality } from "@langchain-chess/chess-ui";
import { ply, turn } from "@langchain-chess/chess-ui/testing";
import { STATUS_KEY } from "../../src/analysis";
import type { Game } from "../../src/games";
import {
  GRADER,
  PART_KEY,
  REVIEW_KEY,
  type Eval,
  type GameReview,
  type Grading,
} from "../../src/review";

/** Scholar's mate: White's queen and bishop mate on f7; Black's 3...Nf6?? allows it. */
export const MOVES = ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7"];
const SANS = ["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7#"];
const QUALITY: Quality[] = ["best", "best", "good", "best", "best", "blunder", "best"];
const EVALS: Eval[] = [
  { cp: 30 },
  { cp: 35 },
  { cp: 25 },
  { cp: -20 },
  { cp: 40 },
  { cp: 30 },
  { mate: 1, winner: "white" },
  { mate: 0, winner: "white" },
];

export function values(overrides: Partial<ChessValues> = {}): ChessValues {
  return {
    start_fen: START_FEN,
    moves: MOVES,
    plies: MOVES.map((uci, i) =>
      ply({
        ply: i,
        uci,
        san: SANS[i],
        side: i % 2 ? "black" : "white",
        source: i % 2 ? "llm" : "external",
        turn_id: i % 2 ? `turn-${i}` : null,
        model: i % 2 ? "anthropic:claude-opus-5-5" : null,
      }),
    ),
    turns: MOVES.flatMap((_, i) => (i % 2 ? [turn({ id: `turn-${i}`, ply: i })] : [])),
    outcome: { kind: "checkmate", winner: "white" },
    error: null,
    messages: [],
    ...overrides,
  };
}

export function review(overrides: Partial<GameReview> = {}): GameReview {
  return {
    version: 1,
    engine: "Stockfish 19",
    settings: { depth: 16, multipv: 2, threads: 1, hash_mb: 256 },
    accuracy: { white: 97.5, black: 61.2 },
    evals: EVALS,
    plies: MOVES.map((uci, i) => ({
      ply: i,
      run_id: `run-${Math.ceil(i / 2)}`,
      side: i % 2 ? "black" : "white",
      uci,
      best_move: i === 5 ? "d7d5" : uci,
      quality: QUALITY[i],
      cp_loss: i === 5 ? 1000 : 0,
      win_pct_loss: i === 5 ? 38.4 : 0,
      accuracy: i === 5 ? 12 : 100,
      lines: i === 5 ? [{ eval: { cp: 30 }, pv: ["d7d5", "c4d5"] }] : [],
    })),
    ...overrides,
  };
}

export const UNGRADED: Grading = { status: "ungraded" };

export function graded(overrides: Partial<GameReview> = {}): Grading {
  return { status: "graded", review: review(overrides) };
}

export function game(overrides: Partial<Game> = {}): Game {
  return {
    threadId: "thread-1",
    lastRunId: "run-3",
    lastRunStartTime: "2026-09-25T12:30:00Z",
    startedAt: "2026-09-25T12:00:00Z",
    turns: 4,
    matchup: "claude-opus-5-5 + semif-qwen3.5-4b",
    surface: "web",
    values: values(),
    grading: graded(),
    mark: null,
    ...overrides,
  };
}

export function reviewFeedback(
  runId: string,
  value: unknown = review(),
  grader = GRADER,
  createdAt = "2026-09-25T12:31:00Z",
) {
  return {
    key: REVIEW_KEY,
    run_id: runId,
    value,
    created_at: createdAt,
    feedback_source: { metadata: { grader } },
  };
}

/** A version 1 review as `lcchess grade` now writes it: a header, and parts of `sizes` plies. */
export function versionTwo(r: GameReview = review(), sizes = [3, 4], generation = "g1") {
  const header = {
    version: 2,
    generation,
    engine: r.engine,
    settings: r.settings,
    accuracy: r.accuracy,
    plies: r.plies.length,
    parts: sizes.length,
    final_eval: r.evals.at(-1),
  };
  let from = 0;
  const parts = sizes.map((n, part) => {
    const value = {
      version: 2,
      generation,
      part,
      from,
      evals: r.evals.slice(from, from + n),
      plies: r.plies.slice(from, from + n),
    };
    from += n;
    return value;
  });
  return { header, parts };
}

export function partFeedback(runId: string, value: unknown, grader = GRADER) {
  return { key: PART_KEY, run_id: runId, value, feedback_source: { metadata: { grader } } };
}

export function statusFeedback(
  runId: string,
  value: unknown,
  {
    id = `${runId}-mark`,
    createdAt = "2026-09-25T11:58:00Z",
    comment = null as string | null,
  } = {},
  grader = GRADER,
) {
  return {
    id,
    key: STATUS_KEY,
    run_id: runId,
    value,
    comment,
    created_at: createdAt,
    feedback_source: { metadata: { grader } },
  };
}
