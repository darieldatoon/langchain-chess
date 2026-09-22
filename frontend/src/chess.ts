import { Chess } from "chess.js";
import { START_FEN } from "./types";

export interface Attempt {
  uci: string;
  san: string;
  fen: string;
}

/** Legal-move check for a drag on the client; the graph re-validates server side. */
export function tryMove(fen: string, from: string, to: string, promotion = "q"): Attempt | null {
  const game = new Chess(fen);
  const legal = game.moves({ verbose: true }).find((m) => m.from === from && m.to === to);
  if (!legal) return null;
  const move = game.move({ from, to, promotion: legal.promotion ? promotion : undefined });
  return { uci: move.from + move.to + (move.promotion ?? ""), san: move.san, fen: game.fen() };
}

export function sideToMove(fen: string): "white" | "black" {
  return fen.split(" ")[1] === "b" ? "black" : "white";
}

export function isOwnPiece(piece: string, side: "white" | "black"): boolean {
  return piece.startsWith(side === "white" ? "w" : "b");
}

export function fenOrStart(fen: string | undefined): string {
  return fen ?? START_FEN;
}
