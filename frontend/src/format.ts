import type { PlyView, Side, Status } from "./types";

export function money(usd: number | null | undefined): string {
  if (usd == null) return "n/a";
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(3)}`;
}

export function seconds(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

export function sourceLabel(source: string): string {
  switch (source) {
    case "jev":
      return "Jev played";
    case "llm":
      return "LLM chose";
    case "fallback_jev":
      return "LLM failed, Jev played";
    case "fallback_random":
      return "LLM failed, random move";
    case "engine":
      return "Engine";
    default:
      return source;
  }
}

export function sourceClass(source: string | undefined): string {
  if (!source) return "";
  return source.startsWith("fallback") ? "fallback" : source;
}

export type MoveRow = [number, PlyView | undefined, PlyView | undefined];

export function pairs(plies: PlyView[]): MoveRow[] {
  const out: MoveRow[] = [];
  const byPly = new Map(plies.map((p) => [p.ply, p]));
  const last = plies.length ? Math.max(...plies.map((p) => p.ply)) : 0;
  for (let ply = 1; ply <= last; ply += 2) {
    out.push([(ply + 1) / 2, byPly.get(ply), byPly.get(ply + 1)]);
  }
  return out;
}

export function lastMoveStyles(uci: string | null): Record<string, React.CSSProperties> {
  if (!uci || uci.length < 4) return {};
  const highlight = { backgroundColor: "var(--board-last-move)" };
  return { [uci.slice(0, 2)]: highlight, [uci.slice(2, 4)]: highlight };
}

export interface StatusInput {
  status: Status;
  result: string | null;
  history: string[];
  humanSide: Side;
}

export function statusLine(game: StatusInput): string {
  if (game.status === "checkmate") return `Checkmate. ${game.result}`;
  if (game.status === "stalemate") return "Stalemate. Draw.";
  if (game.status === "draw") return "Draw.";
  if (game.status === "max_plies") return "Move limit reached. Called a draw.";
  if (game.history.length === 0) {
    return game.humanSide === "white" ? "Your move." : "Press Start and the opponent opens.";
  }
  return game.humanSide === (game.history.length % 2 === 0 ? "white" : "black")
    ? "Your move."
    : "Opponent to move.";
}

export function describeError(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : JSON.stringify(error);
}

const STICK_TOLERANCE_PX = 8;

export function isAtBottom(el: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_TOLERANCE_PX;
}

/** Macaw's Slider reports a range as an array; the threshold is a single value. */
export function sliderValue(value: number | number[]): number {
  return Array.isArray(value) ? value[0] : value;
}
