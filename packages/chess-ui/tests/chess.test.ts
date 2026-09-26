import { describe, expect, it } from "vite-plus/test";
import {
  fenOrStart,
  fullmoveNumber,
  isFen,
  isOwnPiece,
  isPromotion,
  opposite,
  positions,
  replay,
  sanAt,
  sideToMove,
  tryMove,
} from "../src/chess";
import { START_FEN } from "../src/types";

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

  it("knows which legal moves need a promotion piece", () => {
    expect(isPromotion(PROMO, "a7", "a8")).toBe(true);
    expect(isPromotion(PROMO, "a1", "a2")).toBe(false);
    expect(isPromotion(PROMO, "a7", "b8")).toBe(false);
  });
});

describe("helpers", () => {
  it("reads the side to move", () => {
    expect(sideToMove(START_FEN)).toBe("white");
    expect(sideToMove("8/8/8/8/8/8/8/8 b - - 0 1")).toBe("black");
    expect(opposite("white")).toBe("black");
    expect(opposite("black")).toBe("white");
  });

  it("matches piece colour to side", () => {
    expect(isOwnPiece("wP", "white")).toBe(true);
    expect(isOwnPiece("bK", "white")).toBe(false);
    expect(isOwnPiece("bK", "black")).toBe(true);
  });

  it("tells a FEN from anything else", () => {
    expect(isFen(START_FEN)).toBe(true);
    expect(isFen("not a fen")).toBe(false);
  });

  it("falls back to the start position", () => {
    expect(fenOrStart(undefined)).toBe(START_FEN);
    expect(fenOrStart("")).toBe(START_FEN);
    expect(fenOrStart("x")).toBe("x");
  });

  it("reads the fullmove number, defaulting to 1", () => {
    expect(fullmoveNumber(START_FEN)).toBe(1);
    expect(fullmoveNumber("8/8/8/8/8/8/8/K6k b - - 3 42")).toBe(42);
    expect(fullmoveNumber("8/8/8/8/8/8/8/K6k w - -")).toBe(1);
  });
});

describe("replay", () => {
  it("lists every position in one pass, each the replay of its prefix", () => {
    const moves = ["e2e4", "e7e5", "g1f3", "zz99", "b8c6"];
    const fens = positions(START_FEN, moves);
    expect(fens).toHaveLength(moves.length + 1);
    expect(fens[0]).toBe(START_FEN);
    fens
      .slice(1)
      .forEach((fen, i) => expect(fen).toBe(replay(START_FEN, moves.slice(0, i + 1)).fen));
    expect(fens[5]).toBe(fens[3]);
  });

  it("replays UCI moves, promotions included, and reports SAN", () => {
    expect(replay(START_FEN, ["e2e4", "e7e5", "g1f3"])).toEqual({
      fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2",
      sans: ["e4", "e5", "Nf3"],
    });
    expect(replay(PROMO, ["a7a8n"]).sans).toEqual(["a8=N"]);
  });

  it("stops at the first move it can't play", () => {
    const result = replay(START_FEN, ["e2e4", "e2e4", "e7e5"]);
    expect(result.sans).toEqual(["e4"]);
    expect(result.fen).toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1");
  });

  it("names a move at a position, or echoes the UCI when it is illegal there", () => {
    expect(sanAt(START_FEN, "g1f3")).toBe("Nf3");
    expect(sanAt(START_FEN, "e7e5")).toBe("e7e5");
  });
});
