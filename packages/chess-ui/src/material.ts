// Material on the board, from the FEN alone, so a promotion or a custom start counts as it
// stands. Pure; the idea is Lichess's ui/lib/src/game/material.ts.
import type { Side } from "./types";

export type Role = "q" | "r" | "b" | "n" | "p";
export type PieceCounts = Record<Role, number>;

/** Largest first, as the strips show them. */
export const ROLES: readonly Role[] = ["q", "r", "b", "n", "p"];
export const POINTS: Record<Role, number> = { q: 9, r: 5, b: 3, n: 3, p: 1 };

const none = (): PieceCounts => ({ q: 0, r: 0, b: 0, n: 0, p: 0 });

function counts(fen: string): Record<Side, PieceCounts> {
  const found = { white: none(), black: none() };
  for (const char of fen.split(" ")[0]) {
    const role = char.toLowerCase();
    if (!(role in POINTS)) continue;
    found[char === role ? "black" : "white"][role as Role] += 1;
  }
  return found;
}

/** The pieces each side has beyond the other's, per role. */
export function materialDiff(fen: string): Record<Side, PieceCounts> {
  const { white, black } = counts(fen);
  const beyond = (a: PieceCounts, b: PieceCounts) =>
    Object.fromEntries(ROLES.map((r) => [r, Math.max(0, a[r] - b[r])])) as PieceCounts;
  return { white: beyond(white, black), black: beyond(black, white) };
}

/** White's lead in points; kings don't count. */
export function materialScore(fen: string): number {
  const { white, black } = counts(fen);
  return ROLES.reduce((sum, r) => sum + POINTS[r] * (white[r] - black[r]), 0);
}
