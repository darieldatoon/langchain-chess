import { describe, expect, it } from "vite-plus/test";
import { fenOrStart, isOwnPiece, sideToMove, tryMove } from "./chess";
import { START_FEN } from "./types";

const PROMO = "8/P6k/8/8/8/8/8/K7 w - - 0 1";

describe("tryMove", () => {
  it("accepts a legal move and reports uci, san, and the new fen", () => {
    const attempt = tryMove(START_FEN, "e2", "e4");
    expect(attempt).toEqual({
      uci: "e2e4",
      san: "e4",
      fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    });
  });

  it("rejects an illegal move", () => {
    expect(tryMove(START_FEN, "e2", "e5")).toBeNull();
    expect(tryMove(START_FEN, "e7", "e5")).toBeNull();
  });

  it("promotes to a queen by default", () => {
    expect(tryMove(PROMO, "a7", "a8")?.uci).toBe("a7a8q");
    expect(tryMove(PROMO, "a7", "a8", "n")?.san).toBe("a8=N");
  });
});

describe("helpers", () => {
  it("reads the side to move", () => {
    expect(sideToMove(START_FEN)).toBe("white");
    expect(sideToMove("8/8/8/8/8/8/8/8 b - - 0 1")).toBe("black");
  });

  it("matches piece colour to side", () => {
    expect(isOwnPiece("wP", "white")).toBe(true);
    expect(isOwnPiece("bK", "white")).toBe(false);
    expect(isOwnPiece("bK", "black")).toBe(true);
  });

  it("falls back to the start position", () => {
    expect(fenOrStart(undefined)).toBe(START_FEN);
    expect(fenOrStart("x")).toBe("x");
  });
});
