import { describe, expect, it } from "vite-plus/test";
import keys from "./fixtures/position-keys.json";
import { replay } from "../src/chess";
import {
  loadOpenings,
  openingAt,
  openingFamily,
  openingTitle,
  positionKey,
  type OpeningTable,
} from "../src/openings";
import { START_FEN } from "../src/types";

const fens = (moves: string[], start = START_FEN) => replay(start, moves).fens;
const key = (moves: string[], start = START_FEN) => positionKey(fens(moves, start).at(-1)!);

describe("positionKey", () => {
  it.each(keys.map((k) => [k.name, k.fen, k.key]))(
    "keys %s as python-chess does",
    (_, fen, expected) => {
      expect(positionKey(fen)).toBe(expected);
    },
  );
});

describe("positionKey with rights a FEN claims", () => {
  it("drops castling rights whose king or rook has gone, as python-chess does", () => {
    expect(positionKey("4k3/8/8/8/8/8/8/4K3 w KQkq - 0 1")).toBe("4k3/8/8/8/8/8/8/4K3 w - -");
    expect(positionKey("r3k2r/8/8/8/8/8/8/R4K1R w KQkq - 0 1")).toBe(
      "r3k2r/8/8/8/8/8/8/R4K1R w kq -",
    );
  });
});

describe("openingAt", () => {
  const TABLE: OpeningTable = {
    [key(["e2e4", "c7c5"])]: ["B20", "Sicilian Defense"],
    [key(["e2e4", "c7c5", "g1f3", "d7d6", "d2d4"])]: ["B53", "Sicilian Defense: Modern Variations"],
    [key(["g1f3", "d7d5", "d2d4"])]: ["D02", "Queen's Pawn Game: Zukertort Variation"],
  };

  it("names nothing before an opening is reached", () => {
    expect(openingAt(fens(["e2e4"]), 1, TABLE)).toBeNull();
    expect(openingAt(fens(["e2e4", "c7c5"]), 1, TABLE)).toBeNull();
  });

  it("names the latest opening reached at or before the position", () => {
    const game = fens(["e2e4", "c7c5", "g1f3", "d7d6", "d2d4"]);
    expect(openingAt(game, 2, TABLE)).toEqual({
      eco: "B20",
      name: "Sicilian Defense",
      reachedIndex: 2,
    });
    expect(openingAt(game, 4, TABLE)?.eco).toBe("B20");
    expect(openingAt(game, 5, TABLE)).toMatchObject({ eco: "B53", reachedIndex: 5 });
    // Past the end of the game, the last position counts.
    expect(openingAt(game, 99, TABLE)?.reachedIndex).toBe(5);
  });

  it("holds the name once the game leaves the book", () => {
    const game = fens(["e2e4", "c7c5", "a2a3", "h7h6", "b2b3"]);
    expect(openingAt(game, 5, TABLE)).toMatchObject({ eco: "B20", reachedIndex: 2 });
  });

  it("finds a transposition", () => {
    const game = fens(["d2d4", "d7d5", "g1f3"]);
    expect(openingAt(game, 3, TABLE)).toMatchObject({ eco: "D02", reachedIndex: 3 });
  });

  it("names a repeated position by its latest occurrence", () => {
    const game = fens(["e2e4", "c7c5", "g1f3", "g8f6", "f3g1", "f6g8"]);
    expect(openingAt(game, 6, TABLE)).toMatchObject({ eco: "B20", reachedIndex: 6 });
  });

  it("names a custom root that is in the book at index 0, and no other", () => {
    const sicilian = fens(["e2e4", "c7c5"]).at(-1)!;
    expect(openingAt([sicilian], 0, TABLE)).toMatchObject({ eco: "B20", reachedIndex: 0 });
    expect(openingAt(["8/8/4k3/8/8/4K3/8/8 w - - 0 1"], 0, TABLE)).toBeNull();
  });

  it("titles and families", () => {
    const najdorf = { eco: "B90", name: "Sicilian Defense: Najdorf Variation" };
    expect(openingTitle(najdorf)).toBe("B90 · Sicilian Defense: Najdorf Variation");
    expect(openingFamily(najdorf)).toBe("Sicilian Defense");
    expect(openingFamily({ name: "King's Pawn Game" })).toBe("King's Pawn Game");
  });
});

describe("loadOpenings", () => {
  it("loads the generated table once", async () => {
    const table = await loadOpenings();
    expect(await loadOpenings()).toBe(table);
    const sicilian = openingAt(fens(["e2e4", "c7c5"]), 2, table);
    expect(sicilian).toEqual({ eco: "B20", name: "Sicilian Defense", reachedIndex: 2 });
  });
});
