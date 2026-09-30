import { Chess, validateFen } from "chess.js";
import { START_FEN, type Side } from "./types";

export interface Attempt {
  uci: string;
  san: string;
  fen: string;
}

export type Promotion = "q" | "r" | "b" | "n";
export const PROMOTIONS: readonly Promotion[] = ["q", "r", "b", "n"];

/** Whether moving from `from` to `to` is a legal pawn promotion, so it needs a piece chosen. */
export function isPromotion(fen: string, from: string, to: string): boolean {
  return new Chess(fen)
    .moves({ verbose: true })
    .some((m) => m.from === from && m.to === to && m.promotion !== undefined);
}

/** Legal-move check for a drag on the client; the graph re-validates server side. */
export function tryMove(
  fen: string,
  from: string,
  to: string,
  promotion: Promotion = "q",
): Attempt | null {
  const game = new Chess(fen);
  const legal = game.moves({ verbose: true }).find((m) => m.from === from && m.to === to);
  if (!legal) return null;
  const move = game.move({ from, to, promotion: legal.promotion ? promotion : undefined });
  return { uci: move.from + move.to + (move.promotion ?? ""), san: move.san, fen: game.fen() };
}

/** A FEN's fields: chess.js and python-chess accept any run of whitespace between them. */
export function fenFields(fen: string): string[] {
  return fen.trim().split(/\s+/);
}

/** One space between fields: what the board, the PGN and the server are given. */
export function normalizeFen(fen: string): string {
  return fenFields(fen).join(" ");
}

export function sideToMove(fen: string): Side {
  return fenFields(fen)[1] === "b" ? "black" : "white";
}

export function opposite(side: Side): Side {
  return side === "white" ? "black" : "white";
}

export function fullmoveNumber(fen: string): number {
  const n = Number(fenFields(fen)[5]);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export function isOwnPiece(piece: string, side: Side): boolean {
  return piece.startsWith(side === "white" ? "w" : "b");
}

export function isFen(fen: string): boolean {
  return validateFen(fen).ok;
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
  /** The start and the position after each move, one per move: from a rejected move on, the
   * position stays put. */
  fens: string[];
}

/** Replays UCI moves from a root; the server is the authority, so a bad move just stops it. */
export function replay(startFen: string, moves: readonly string[]): Replay {
  const game = new Chess(startFen);
  const sans: string[] = [];
  const fens = [startFen];
  let playing = true;
  for (const uci of moves) {
    if (playing) {
      try {
        sans.push(play(game, uci).san);
      } catch {
        playing = false;
      }
    }
    fens.push(game.fen());
  }
  return { fen: game.fen(), sans, fens };
}

/** SAN for a move at a position, or the UCI itself when it isn't legal there. */
export function sanAt(fen: string, uci: string): string {
  try {
    return play(new Chess(fen), uci).san;
  } catch {
    return uci;
  }
}

/** Why a starting position can't be played, or null when it can. */
export function validateStart(text: string): string | null {
  // chess.js loads only single-spaced fields.
  const fen = normalizeFen(text);
  // chess.js also requires exactly one king a side.
  const check = validateFen(fen);
  if (!check.ok) return check.error!;
  const fields = fenFields(fen);
  const other = [fields[0], fields[1] === "w" ? "b" : "w", "-", "-", "0", "1"].join(" ");
  if (new Chess(other).inCheck()) return "The side not to move is in check.";
  const game = new Chess(fen);
  if (game.isCheckmate()) return "That position is already checkmate.";
  if (game.isStalemate()) return "That position is already stalemate.";
  return null;
}
