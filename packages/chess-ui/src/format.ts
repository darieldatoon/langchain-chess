import { fullmoveNumber, opposite, sideToMove } from "./chess";
import type { TurnCost } from "./selectors";
import type { DrawReason, Outcome, Side } from "./types";

export function money(usd: number): string {
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(3)}`;
}

export interface CostText {
  text: string;
  /** Some call was unpriced or approximated, so the total is a lower bound. */
  incomplete: boolean;
}

export function costText(cost: TurnCost | null): CostText {
  if (!cost) return { text: "—", incomplete: false };
  return cost.complete
    ? { text: money(cost.usd), incomplete: false }
    : { text: `${money(cost.usd)}+`, incomplete: true };
}

export function seconds(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

export function percent(probability: number): string {
  return `${(probability * 100).toFixed(0)}%`;
}

export function sourceLabel(source: string): string {
  switch (source) {
    case "external":
      return "Human";
    case "llm":
      return "LLM chose";
    case "systemone":
      return "System 1 played";
    case "forced":
      return "Forced move";
    default:
      return source;
  }
}

export type SourceClass = "external" | "llm" | "systemone" | "forced" | "other";

export function sourceClass(source: string): SourceClass {
  switch (source) {
    case "external":
    case "llm":
    case "systemone":
    case "forced":
      return source;
    default:
      return "other";
  }
}

export interface MoveEntry {
  ply: number;
  san: string;
  source: string;
}

export type MoveRow = [number, MoveEntry | undefined, MoveEntry | undefined];

/** Rows numbered from the root FEN, which may have Black to move and any fullmove number. */
export function pairs(entries: readonly MoveEntry[], startFen: string): MoveRow[] {
  const first = fullmoveNumber(startFen);
  const offset = sideToMove(startFen) === "black" ? 1 : 0;
  const rows: MoveRow[] = [];
  entries.forEach((entry, i) => {
    const slot = i + offset;
    const row = Math.floor(slot / 2);
    rows[row] ??= [first + row, undefined, undefined];
    rows[row][slot % 2 === 0 ? 1 : 2] = entry;
  });
  return rows;
}

export function lastMoveStyles(uci: string | null): Record<string, React.CSSProperties> {
  if (!uci || uci.length < 4) return {};
  const highlight = { backgroundColor: "var(--board-last-move)" };
  return { [uci.slice(0, 2)]: highlight, [uci.slice(2, 4)]: highlight };
}

const DRAW_REASONS: Record<DrawReason, string> = {
  stalemate: "stalemate",
  insufficient_material: "insufficient material",
  threefold: "threefold repetition",
  fivefold: "fivefold repetition",
  fifty_moves: "the fifty-move rule",
  seventyfive_moves: "the seventy-five-move rule",
};

const colour = (side: Side) => (side === "white" ? "White" : "Black");
const score = (winner: Side) => (winner === "white" ? "1-0" : "0-1");

export function outcomeLine(outcome: Outcome): string {
  switch (outcome.kind) {
    case "checkmate":
      return `Checkmate, ${colour(outcome.winner)} wins. ${score(outcome.winner)}`;
    case "draw":
      return `Draw by ${DRAW_REASONS[outcome.reason]}. 1/2-1/2`;
    case "resignation":
      return `${colour(opposite(outcome.winner))} resigns after repeated illegal moves. ${score(outcome.winner)}`;
  }
}

const STICK_TOLERANCE_PX = 8;

export function isAtBottom(el: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_TOLERANCE_PX;
}
