// What the board marks on its squares. Pure; Board.tsx feeds these to react-chessboard.
import { Chess, type Square } from "chess.js";
import type { CSSProperties } from "react";
import type { Promotion } from "./chess";
import type { Side } from "./types";

const FILES = "abcdefgh";

/** The squares the piece on `square` can legally move to. */
export function destinations(fen: string, square: string): string[] {
  const moves = new Chess(fen).moves({ square: square as Square, verbose: true });
  return [...new Set(moves.map((m) => m.to))];
}

/** The king of the side to move, when it is in check. */
export function checkedKing(fen: string): string | null {
  const game = new Chess(fen);
  if (!game.inCheck()) return null;
  const turn = game.turn();
  // In check, so that king is on the board.
  return game
    .board()
    .flat()
    .find((p) => p?.type === "k" && p.color === turn)!.square;
}

export interface PromotionSlot {
  piece: Promotion;
  square: string;
  /** From the board's top left, as the reader sees it. */
  column: number;
  row: number;
}

/** Queen first, on the promotion square, then knight, rook and bishop towards the centre. */
export const PROMOTION_ORDER: readonly Promotion[] = ["q", "n", "r", "b"];

export function promotionSquares(to: string, orientation: Side): PromotionSlot[] {
  const file = FILES.indexOf(to[0]);
  const rank = Number(to[1]);
  const inward = rank === 8 ? -1 : 1;
  return PROMOTION_ORDER.map((piece, i) => {
    const r = rank + inward * i;
    return {
      piece,
      square: `${to[0]}${r}`,
      column: orientation === "white" ? file : 7 - file,
      row: orientation === "white" ? 8 - r : r - 1,
    };
  });
}

export interface Highlights {
  lastMove: string | null;
  selected: string | null;
  /** Legal targets of the selected or dragged piece; empty when they aren't shown. */
  targets: readonly string[];
  /** The fen the targets are on: an occupied target gets a ring, an empty one a dot. */
  fen: string;
  /** A legal target under a fine pointer: filled instead of dotted. */
  hover: string | null;
  check: string | null;
}

const layer = (colour: string) => `linear-gradient(${colour}, ${colour})`;
// Sized to the square's half-width, not its corner: a dot about 20% of the square across, and a
// ring from 80% to the edge with the corners left clear.
const DOT = "radial-gradient(circle closest-side, var(--board-move-dot) 20%, transparent 22%)";
const RING =
  "radial-gradient(circle closest-side, transparent 80%, var(--board-move-ring) 82%, var(--board-move-ring) 98%, transparent 100%)";
const CHECK =
  "radial-gradient(ellipse at center, var(--board-check) 0%, color-mix(in srgb, var(--board-check) 40%, transparent) 45%, transparent 75%)";

function occupied(fen: string): Set<string> {
  const squares = new Set<string>();
  fen
    .split(" ")[0]
    .split("/")
    .forEach((row, i) => {
      let file = 0;
      for (const char of row) {
        if (/\d/.test(char)) file += Number(char);
        else squares.add(`${FILES[file++]}${8 - i}`);
      }
    });
  return squares;
}

/** How many squares differ between two positions' placements. */
export function squaresChanged(a: string, b: string): number {
  const cells = (fen: string) =>
    fen
      .split(" ")[0]
      .replace(/\d/g, (n) => ".".repeat(Number(n)))
      .replaceAll("/", "");
  const [x, y] = [cells(a), cells(b)];
  return x.split("").filter((c, i) => c !== y[i]).length;
}

/** The most squares one move changes: castling. More is a jump, such as a game loading. */
export const MOVE_SQUARES = 4;

/** Per square: the last move's tint as its colour, and the rest as layers over it. */
export function squareHighlights(h: Highlights): Record<string, CSSProperties> {
  const images = new Map<string, string[]>();
  const add = (square: string, image: string) =>
    images.set(square, [...(images.get(square) ?? []), image]);
  if (h.check) add(h.check, CHECK);
  if (h.selected) add(h.selected, layer("var(--board-selected)"));
  const pieces = occupied(h.fen);
  for (const target of h.targets) {
    if (target === h.hover) add(target, layer("var(--board-hover)"));
    else add(target, pieces.has(target) ? RING : DOT);
  }
  const styles: Record<string, CSSProperties> = {};
  if (h.lastMove && h.lastMove.length >= 4) {
    for (const square of [h.lastMove.slice(0, 2), h.lastMove.slice(2, 4)]) {
      styles[square] = { backgroundColor: "var(--board-last-move)" };
    }
  }
  for (const [square, layers] of images) {
    styles[square] = { ...styles[square], backgroundImage: layers.join(", ") };
  }
  return styles;
}

/** A resolved colour at `alpha`, for the review's pale arrows. */
export function withAlpha(colour: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(colour.trim());
  if (hex) {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(colour.trim());
  if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`;
  return `color-mix(in srgb, ${colour} ${alpha * 100}%, transparent)`;
}
