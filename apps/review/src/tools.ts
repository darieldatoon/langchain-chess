// What the review's tools column shows, computed from the grades and the game record. Pure.
import {
  fullmoveNumber,
  replay,
  sanAt,
  sideToMove,
  turnCost,
  turnOf,
  type Ply,
  type Quality,
  type Side,
  type TurnRecord,
} from "@langchain-chess/chess-ui";
import type { GameReview, PlyGrade } from "./review";
import { recordsByPly } from "./values";

/** The engine's search limit, whichever of the three the grader wrote. */
export function searchLimit(settings: Readonly<Record<string, number>>): string | null {
  if (settings.depth !== undefined) return `depth ${settings.depth}`;
  if (settings.nodes !== undefined) return `${settings.nodes.toLocaleString("en-US")} nodes`;
  if (settings.movetime !== undefined) return `${settings.movetime} ms a move`;
  return null;
}

/** The grades that earn a note, a count and a symbol. */
export const FLAWS = ["inaccuracy", "mistake", "blunder"] as const;
export type Flaw = (typeof FLAWS)[number];

export const isFlaw = (quality: Quality): quality is Flaw =>
  (FLAWS as readonly string[]).includes(quality);

export type FlawCounts = Record<Flaw, number>;

export interface SourceGroup {
  /** `systemone`, `llm`, `forced`, `external`, or `unknown` for a grade with no ply record. */
  source: string;
  /** At least one: a source with no graded moves has no group. */
  moves: number;
  counts: FlawCounts;
  acpl: number;
  /** The mean of the moves' own accuracy: not the game accuracy. */
  meanAccuracy: number;
}

export interface SideSummary {
  counts: FlawCounts;
  /** Null for no graded moves. */
  acpl: number | null;
  /** The grader's game accuracy. */
  accuracy: number | null;
  bySource: SourceGroup[];
}

const mean = (values: readonly number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

const countFlaws = (grades: readonly PlyGrade[]): FlawCounts => ({
  inaccuracy: grades.filter((g) => g.quality === "inaccuracy").length,
  mistake: grades.filter((g) => g.quality === "mistake").length,
  blunder: grades.filter((g) => g.quality === "blunder").length,
});

const SOURCES = ["systemone", "llm", "forced", "external"];

export function summarize(review: GameReview, plies: readonly Ply[]): Record<Side, SideSummary> {
  const records = recordsByPly(plies, review.plies.length);
  const side = (who: Side): SideSummary => {
    const grades = review.plies.filter((g) => g.side === who);
    const sourceOf = (g: PlyGrade) => records[g.ply]?.source ?? "unknown";
    const present = [...new Set(grades.map(sourceOf))];
    const order = (s: string) => (SOURCES.includes(s) ? SOURCES.indexOf(s) : SOURCES.length);
    return {
      counts: countFlaws(grades),
      acpl: grades.length ? mean(grades.map((g) => g.cp_loss)) : null,
      accuracy: review.accuracy[who],
      bySource: present
        .sort((a, b) => order(a) - order(b))
        .map((source) => {
          const group = grades.filter((g) => sourceOf(g) === source);
          return {
            source,
            moves: group.length,
            counts: countFlaws(group),
            acpl: mean(group.map((g) => g.cp_loss)),
            meanAccuracy: mean(group.map((g) => g.accuracy)),
          };
        }),
    };
  };
  return { white: side("white"), black: side("black") };
}

/**
 * The position after `side`'s next move of `quality` after position `index`, wrapping round;
 * null when it made none. Ply `p` is shown at position `p + 1`.
 */
export function nextFlaw(
  review: GameReview,
  side: Side,
  quality: Flaw,
  index: number,
): number | null {
  const positions = review.plies
    .filter((g) => g.side === side && g.quality === quality)
    .map((g) => g.ply + 1);
  return positions.find((p) => p > index) ?? positions[0] ?? null;
}

export type AccuracyBand = "success" | "info" | "warning" | "error";

/** ≥ 85, 70–84, 55–69, < 55. */
export function accuracyBand(accuracy: number): AccuracyBand {
  if (accuracy >= 85) return "success";
  if (accuracy >= 70) return "info";
  if (accuracy >= 55) return "warning";
  return "error";
}

export const FLAW_LABELS: Record<Flaw, string> = {
  inaccuracy: "Inaccuracy",
  mistake: "Mistake",
  blunder: "Blunder",
};

/** The best line's plies a note shows. */
export const NOTE_PLIES = 6;

export interface FlawNote {
  quality: Flaw;
  /** "Blunder. Qd8 was best." */
  text: string;
  /** The engine's best line from the position before, in SAN. */
  line: string;
}

/** The row under a flawed move, or null for a move that needs none. */
export function flawNote(grade: PlyGrade | undefined, fenBefore: string): FlawNote | null {
  if (!grade || !isFlaw(grade.quality)) return null;
  const best = grade.best_move ? sanAt(fenBefore, grade.best_move) : null;
  const pv = grade.lines[0]?.pv.slice(0, NOTE_PLIES) ?? [];
  return {
    quality: grade.quality,
    text: best
      ? `${FLAW_LABELS[grade.quality]}. ${best} was best.`
      : `${FLAW_LABELS[grade.quality]}.`,
    line: replay(fenBefore, pv).sans.join(" "),
  };
}

/** A line played out from `base`: SAN and the position after each move. */
export interface Line {
  base: string;
  moves: readonly string[];
  sans: string[];
  /** One per move: the position after it. */
  fens: string[];
}

/** Only the moves that replay: a line the feedback claims can hold an illegal one. */
export function previewFens(base: string, moves: readonly string[]): Line {
  const played = replay(base, moves);
  const legal = played.sans.length;
  return {
    base,
    moves: moves.slice(0, legal),
    sans: played.sans,
    fens: played.fens.slice(1, legal + 1),
  };
}

/** A move of a line: a SAN that previews it. */
export const SAN_BUTTON =
  "rounded-xs px-space-1 font-mono hover:bg-surface-level-2-hover [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11";

/** The number before a move of a line: every White move, and the first move when Black starts. */
export function lineNumber(base: string, at: number): string | null {
  const black = sideToMove(base) === "black";
  const slot = at + (black ? 1 : 0);
  const number = fullmoveNumber(base) + Math.floor(slot / 2);
  if (slot % 2 === 0) return `${number}.`;
  return at === 0 ? `${number}…` : null;
}

/** The plies an engine line shows. */
export const LINE_PLIES = 8;

/** A line the board shows instead of the game, from the position before the cursor's move. */
export interface Preview {
  /** Which line: an engine line's rank or a System 1 move. */
  id: string;
  line: Line;
  /** The move shown: an index into `line.fens`. */
  at: number;
  /** The cursor it was opened at: a preview never outlives a cursor change. */
  from: number;
}

export interface LatencyBar {
  /** The ply's position, the index the cursor goes to. */
  index: number;
  label: string;
  /** Seconds; null for an external ply or one with no turn, which draw as gaps. */
  seconds: number | null;
  source: string;
  turn: TurnRecord | null;
}

export function latencyBars(plies: readonly Ply[], turns: readonly TurnRecord[]): LatencyBar[] {
  return plies.map((ply) => {
    const turn = ply.source === "external" ? null : turnOf(ply, turns);
    return {
      index: ply.ply + 1,
      label: ply.san,
      seconds: turn ? ply.latency_ms / 1000 : null,
      source: ply.source,
      turn,
    };
  });
}

export const barCost = (bar: LatencyBar) => (bar.turn ? turnCost(bar.turn.calls) : null);

/** A flaw note's tint, like its grade in the move list. */
export const NOTE_CLASSES: Record<Flaw, string> = {
  inaccuracy: "bg-warning-subtle text-warning-secondary",
  mistake: "bg-warning-subtle text-warning-primary",
  blunder: "bg-error-subtle text-error-primary",
};

/** The tabs under the board, in order. */
export const REVIEW_TABS = ["graph", "latency", "export"] as const;
export type ReviewTab = (typeof REVIEW_TABS)[number];
