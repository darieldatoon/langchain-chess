// Opening names from Lichess's CC0 chess-openings (scripts/openings.py writes the table). Pure,
// but for `loadOpenings`, which fetches the table once.
import { Chess } from "chess.js";

export interface Opening {
  eco: string;
  name: string;
  /** The position it was reached at: 0 is the root. */
  reachedIndex: number;
}

/** Position keys to `[eco, name]`. */
export type OpeningTable = Readonly<Record<string, readonly [string, string]>>;

const CASTLING: readonly [string, string, string, string][] = [
  // right, king square, rook square, piece letters
  ["K", "e1", "h1", "wkwr"],
  ["Q", "e1", "a1", "wkwr"],
  ["k", "e8", "h8", "bkbr"],
  ["q", "e8", "a8", "bkbr"],
];

/**
 * Placement, side to move, castling rights that still have their king and rook, and an en passant
 * square only when that capture is legal: python-chess's `board.epd()`, which keys the table.
 */
export function positionKey(fen: string): string {
  const game = new Chess(fen);
  const [placement, side, rights] = game.fen().split(" ");
  const at = (square: string) => {
    const piece = game.get(square as Parameters<Chess["get"]>[0]);
    return piece ? piece.color + piece.type : "";
  };
  const castling =
    CASTLING.filter(
      ([right, king, rook, pieces]) =>
        rights.includes(right) && at(king) === pieces.slice(0, 2) && at(rook) === pieces.slice(2),
    )
      .map(([right]) => right)
      .join("") || "-";
  const enPassant = game.moves({ verbose: true }).find((m) => m.isEnPassant())?.to ?? "-";
  return `${placement} ${side} ${castling} ${enPassant}`;
}

/** The latest named position at or before `index`: it holds after the game leaves the book. */
export function openingAt(
  fens: readonly string[],
  index: number,
  table: OpeningTable,
): Opening | null {
  for (let i = Math.min(index, fens.length - 1); i >= 0; i -= 1) {
    const hit = table[positionKey(fens[i])];
    if (hit) return { eco: hit[0], name: hit[1], reachedIndex: i };
  }
  return null;
}

/** "B90 · Sicilian Defense: Najdorf Variation". */
export function openingTitle(opening: Pick<Opening, "eco" | "name">): string {
  return `${opening.eco} · ${opening.name}`;
}

/** The family, for the page title: "Sicilian Defense" of "Sicilian Defense: Najdorf Variation". */
export function openingFamily(opening: Pick<Opening, "name">): string {
  return opening.name.split(":")[0];
}

let table: Promise<OpeningTable> | null = null;

/** The table, fetched on first use: it is about half a megabyte. */
export function loadOpenings(): Promise<OpeningTable> {
  table ??= import("./generated/openings.json").then(
    (m) => (m.default as unknown as { positions: OpeningTable }).positions,
  );
  return table;
}
