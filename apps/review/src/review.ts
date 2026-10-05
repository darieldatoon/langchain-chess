// The `game_review` feedback `lcchess grade` writes (libs/cli/langchain_chess_cli/grade/records.py
// `review`), and the eval maths the board and graph draw from it. Pure.
import type { Eval, Quality, Side } from "@langchain-chess/chess-ui";
import { isJson, isNumber, isSide, isStrings, type Json } from "./json";

/** A version 1 review, or a version 2 review's header. */
export const REVIEW_KEY = "game_review";
/** A version 2 review's plies, in parts each under LangSmith's feedback size cap. */
export const PART_KEY = "game_review_part";
export const GRADER = "lcchess grade";

export type { Eval };

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

/** A review as the app draws it: version 1, or a version 2 header and its parts joined. */
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
  id?: string;
  key: string;
  run_id: string | null;
  value: unknown;
  comment?: string | null;
  created_at?: string;
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

/** LangSmith stores a feedback value over its size cap as null, and says nothing. */
export const EMPTY = "it is empty; LangSmith may have dropped it for being over its size cap";

const isInteger = (v: unknown): v is number => Number.isInteger(v);

/** A version 2 header's parts of its generation, joined into a version 1 review. */
function joined(header: Json, parts: readonly unknown[]): Json | string {
  const { generation, parts: count, plies } = header;
  if (typeof generation !== "string" || !isInteger(count) || !isInteger(plies)) {
    return "its header is malformed";
  }
  const ours = new Map<unknown, Json>();
  for (const part of parts) {
    if (!isJson(part) || part.generation !== generation) continue;
    if (part.version !== 2) return `part ${String(part.part)} has an unsupported version`;
    const twin = ours.get(part.part);
    if (twin && JSON.stringify(twin) !== JSON.stringify(part)) {
      return `part ${String(part.part)} is stored twice, differently`;
    }
    ours.set(part.part, part);
  }
  const evals: unknown[] = [];
  const grades: unknown[] = [];
  for (let i = 0; i < count; i++) {
    const part = ours.get(i);
    if (!part) return `part ${i + 1} of ${count} is missing`;
    const fits =
      part.from === grades.length &&
      Array.isArray(part.plies) &&
      Array.isArray(part.evals) &&
      part.evals.length === part.plies.length;
    if (!fits) return `part ${i + 1} of ${count} is malformed`;
    evals.push(...(part.evals as unknown[]));
    grades.push(...(part.plies as unknown[]));
  }
  if (grades.length !== plies) return `its parts hold ${grades.length} of its ${plies} plies`;
  const { engine, settings, accuracy } = header;
  return {
    version: 1,
    engine,
    settings,
    accuracy,
    evals: [...evals, header.final_eval],
    plies: grades,
  };
}

/** The review a `game_review` value and the run's `game_review_part` values make. */
export function readReview(header: unknown, parts: readonly unknown[]): Grading {
  if (header === null) return { status: "invalid", problem: EMPTY };
  if (!isJson(header) || header.version !== 2) return parseReview(header);
  const review = joined(header, parts);
  return typeof review === "string" ? { status: "invalid", problem: review } : parseReview(review);
}

/** `created_at` that sorts as time does, the fraction padded to microseconds; "" if it isn't one. */
function instant(at = ""): string {
  const parts = /^(.*T\d\d:\d\d:\d\d)(?:\.(\d+))?(.*)$/.exec(at);
  return parts ? `${parts[1]}.${(parts[2] ?? "").padEnd(6, "0")}${parts[3]}` : "";
}

const newer = (a: FeedbackItem, b: FeedbackItem) =>
  instant(b.created_at) > instant(a.created_at) ? b : a;

/**
 * This grader's reviews by run; other feedback under the same keys is ignored. A regrade
 * publishes its header before deleting the last one's, so the newest header is the review.
 */
export function reviewsByRun(items: readonly FeedbackItem[]): Map<string, Grading> {
  const headers = new Map<string, FeedbackItem>();
  const parts = new Map<string, unknown[]>();
  for (const item of items) {
    const ours = item.feedback_source?.metadata?.grader === GRADER;
    if (!ours || !item.run_id) continue;
    if (item.key === REVIEW_KEY) {
      const header = headers.get(item.run_id);
      headers.set(item.run_id, header ? newer(header, item) : item);
    } else if (item.key === PART_KEY) {
      parts.set(item.run_id, [...(parts.get(item.run_id) ?? []), item.value]);
    }
  }
  return new Map(
    [...headers].map(([run, header]) => [run, readReview(header.value, parts.get(run) ?? [])]),
  );
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
