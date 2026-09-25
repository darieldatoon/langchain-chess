import { Chess } from "chess.js";
import { START_FEN, type Side } from "./types";

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

export function sideToMove(fen: string): Side {
  return fen.split(" ")[1] === "b" ? "black" : "white";
}

export function fullmoveNumber(fen: string): number {
  const n = Number(fen.split(" ")[5]);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export function isOwnPiece(piece: string, side: Side): boolean {
  return piece.startsWith(side === "white" ? "w" : "b");
}

export function fenOrStart(fen: string | undefined): string {
  return fen || START_FEN;
}

function play(game: Chess, uci: string) {
  return game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
}

export interface Replay {
  /** The position after the last move that replayed. */
  fen: string;
  /** SAN per replayed move; stops at the first move chess.js rejects. */
  sans: string[];
}

/** Replays UCI moves from a root; the server is the authority, so a bad move just stops it. */
export function replay(startFen: string, moves: readonly string[]): Replay {
  const game = new Chess(startFen);
  const sans: string[] = [];
  for (const uci of moves) {
    try {
      sans.push(play(game, uci).san);
    } catch {
      break;
    }
  }
  return { fen: game.fen(), sans };
}

/** SAN for a move at a position, or the UCI itself when it isn't legal there. */
export function sanAt(fen: string, uci: string): string {
  try {
    return play(new Chess(fen), uci).san;
  } catch {
    return uci;
  }
}
