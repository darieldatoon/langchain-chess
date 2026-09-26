// The `game_review` feedback `lcchess grade` writes (libs/cli/langchain_chess_cli/grade/records.py
// `review`), and the eval maths the board and graph draw from it. Pure.
import type { Quality, Side } from "@langchain-chess/chess-ui";
import { isJson, isNumber, isSide, isStrings } from "./json";

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

/** A thread's review as the list and board read it; `invalid` is feedback this app can't draw. */
export type Grading =
  | { status: "ungraded" }
  | { status: "graded"; review: GameReview }
  | { status: "invalid"; problem: string };

const QUALITIES: readonly unknown[] = ["best", "good", "inaccuracy", "mistake", "blunder"];

function isEval(v: unknown): boolean {
  if (!isJson(v)) return false;
  return "cp" in v ? isNumber(v.cp) : Number.isInteger(v.mate) && isSide(v.winner);
}

function isPlyGrade(v: unknown, ply: number): boolean {
  return (
    isJson(v) &&
    v.ply === ply &&
    typeof v.run_id === "string" &&
    isSide(v.side) &&
    typeof v.uci === "string" &&
    (v.best_move === null || typeof v.best_move === "string") &&
    QUALITIES.includes(v.quality) &&
    [v.cp_loss, v.win_pct_loss, v.accuracy].every(isNumber) &&
    Array.isArray(v.lines) &&
    v.lines.every((l) => isJson(l) && isEval(l.eval) && isStrings(l.pv))
  );
}

/** The first thing wrong with a review, or null when it is a complete version 1 review. */
function problemWith(v: unknown): string | null {
  if (!isJson(v)) return "it is not an object";
  if (v.version !== 1) {
    return isNumber(v.version)
      ? `version ${v.version} is not supported`
      : "the version is missing or malformed";
  }
  if (typeof v.engine !== "string") return "the engine is missing";
  if (!isJson(v.settings) || !Object.values(v.settings).every(isNumber)) {
    return "the settings are malformed";
  }
  const accuracy = v.accuracy;
  const sideAccuracy = (a: unknown) => a === null || isNumber(a);
  if (!isJson(accuracy) || !sideAccuracy(accuracy.white) || !sideAccuracy(accuracy.black)) {
    return "the accuracy is malformed";
  }
  if (!Array.isArray(v.evals)) return "the evaluations are missing";
  const badEval = v.evals.findIndex((e) => !isEval(e));
  if (badEval >= 0) return `evaluation ${badEval} is malformed`;
  if (!Array.isArray(v.plies)) return "the move grades are missing";
  const badPly = v.plies.findIndex((p, i) => !isPlyGrade(p, i));
  if (badPly >= 0) return `the grade of ply ${badPly} is malformed`;
  if (v.evals.length !== v.plies.length + 1) return "there is not one evaluation per position";
  return null;
}

export function parseReview(value: unknown): Grading {
  const problem = problemWith(value);
  return problem === null
    ? { status: "graded", review: value as GameReview }
    : { status: "invalid", problem };
}

/** This grader's reviews by run; other feedback under the same key is ignored. */
export function reviewsByRun(items: readonly FeedbackItem[]): Map<string, Grading> {
  const reviews = new Map<string, Grading>();
  for (const item of items) {
    const ours = item.feedback_source?.metadata?.grader === GRADER;
    if (item.key === REVIEW_KEY && ours && item.run_id) {
      reviews.set(item.run_id, parseReview(item.value));
    }
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
