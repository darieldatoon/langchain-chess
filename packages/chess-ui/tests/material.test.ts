import { describe, expect, it } from "vite-plus/test";
import { materialDiff, materialScore } from "../src/material";
import { START_FEN } from "../src/types";

const none = { q: 0, r: 0, b: 0, n: 0, p: 0 };

describe("materialDiff and materialScore", () => {
  it("is even at the start", () => {
    expect(materialDiff(START_FEN)).toEqual({ white: none, black: none });
    expect(materialScore(START_FEN)).toBe(0);
  });

  it("counts a custom start from its own position: White up a rook is +5 from move one", () => {
    const fen = "4k3/8/8/8/8/8/8/R3K3 w - - 0 1";
    expect(materialDiff(fen).white).toEqual({ ...none, r: 1 });
    expect(materialDiff(fen).black).toEqual(none);
    expect(materialScore(fen)).toBe(5);
  });

  it("counts a promotion as the piece it became, per side and role", () => {
    // White promoted to a second queen; Black has two extra pawns.
    const fen = "3qk3/pp6/8/8/8/8/8/Q2QK3 b - - 0 40";
    expect(materialDiff(fen)).toEqual({
      white: { ...none, q: 1 },
      black: { ...none, p: 2 },
    });
    expect(materialScore(fen)).toBe(7);
  });

  it("scores bare kings level", () => {
    expect(materialScore("4k3/8/8/8/8/8/8/4K3 w - - 0 1")).toBe(0);
  });
});
