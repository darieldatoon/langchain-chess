// The `game_review` feedback `lcchess grade` writes (libs/cli/langchain_chess_cli/grade/records.py
// `review`), and the eval maths the board and graph draw from it. Pure.
import type { Quality, Side } from "@langchain-chess/chess-ui";

export const REVIEW_KEY = "game_review";
export const GRADER = "lcchess grade";

/** White's side, as the grader stores it. `mate: 0` is a mated position. */
export type Eval = { cp: number } | { mate: number; winner: Side };

export interface EngineLine {
  eval: Eval;
  pv: string[];
}

export interface PlyGrade {
  ply: number;
  run_id: string;
  side: Side;
  uci: string;
  best_move: string | null;
  quality: Quality;
  cp_loss: number;
  win_pct_loss: number;
  accuracy: number;
  /** The engine's lines before the move. */
  lines: EngineLine[];
}

export interface GameReview {
  version: 1;
  engine: string;
  settings: Record<string, number>;
  accuracy: Record<Side, number | null>;
  /** One per position, the start included. */
  evals: Eval[];
  plies: PlyGrade[];
}

export interface FeedbackItem {
  key: string;
  run_id: string | null;
  value: unknown;
  feedback_source?: { metadata?: Record<string, unknown> | null } | null;
}

export function parseReview(value: unknown): GameReview | null {
  if (typeof value !== "object" || value === null) return null;
  const review = value as Partial<GameReview>;
  return review.version === 1 && Array.isArray(review.evals) && Array.isArray(review.plies)
    ? (review as GameReview)
    : null;
}

/** This grader's reviews by run; other feedback under the same key is ignored. */
export function reviewsByRun(items: readonly FeedbackItem[]): Map<string, GameReview> {
  const reviews = new Map<string, GameReview>();
  for (const item of items) {
    const review = parseReview(item.value);
    const ours = item.feedback_source?.metadata?.grader === GRADER;
    if (item.key === REVIEW_KEY && ours && review && item.run_id) reviews.set(item.run_id, review);
  }
  return reviews;
}

const CP_CEILING = 1000;

export function whiteCp(e: Eval): number {
  if ("cp" in e) return Math.max(-CP_CEILING, Math.min(CP_CEILING, e.cp));
  return e.winner === "white" ? CP_CEILING : -CP_CEILING;
}

/** Mirrors `win_percent` in libs/chess/langchain_chess/grading.py, from White's side. */
export function whiteWinPercent(e: Eval): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * whiteCp(e))) - 1);
}

export function evalText(e: Eval): string {
  if ("cp" in e) {
    const pawns = e.cp / 100;
    return `${pawns > 0 ? "+" : ""}${pawns.toFixed(1)}`;
  }
  if (e.mate === 0) return e.winner === "white" ? "1-0" : "0-1";
  return `${e.winner === "white" ? "" : "-"}#${e.mate}`;
}

export type QualityColor = "success" | "plain" | "warning" | "error";

export const QUALITY_COLORS: Record<Quality, QualityColor> = {
  best: "success",
  good: "plain",
  inaccuracy: "warning",
  mistake: "warning",
  blunder: "error",
};

export const QUALITY_LABELS: Record<Quality, string> = {
  best: "Best move",
  good: "Good",
  inaccuracy: "Inaccuracy",
  mistake: "Mistake",
  blunder: "Blunder",
};
