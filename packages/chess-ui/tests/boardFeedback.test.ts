import { describe, expect, it } from "vite-plus/test";
import {
  checkedKing,
  destinations,
  promotionSquares,
  squareHighlights,
  squaresChanged,
  withAlpha,
} from "../src/boardFeedback";
import { DEFAULT_DISPLAY_PREFS, sanitizeDisplayPrefs } from "../src/prefs";
import { START_FEN } from "../src/types";

describe("destinations", () => {
  it("lists a piece's legal targets once each, and none for an empty square", () => {
    expect(destinations(START_FEN, "g1").sort()).toEqual(["f3", "h3"]);
    expect(destinations("8/k1P5/2K5/8/8/8/8/8 w - - 0 1", "c7")).toEqual(["c8"]);
    expect(destinations(START_FEN, "e4")).toEqual([]);
  });
});

describe("checkedKing", () => {
  it("finds the king of the side to move in check", () => {
    expect(checkedKing(START_FEN)).toBeNull();
    expect(checkedKing("rnb1kbnr/pppp1ppp/8/4p3/5PPq/8/PPPPP2P/RNBQKBNR w KQkq - 1 3")).toBe("e1");
    expect(checkedKing("4k3/8/8/8/8/8/8/4K2R b K - 0 1")).toBeNull();
    expect(checkedKing("4k2R/8/8/8/8/8/8/4K3 b - - 0 1")).toBe("e8");
  });
});

describe("promotionSquares", () => {
  it("stacks queen, knight, rook, bishop from the promotion square to the centre", () => {
    expect(promotionSquares("a8", "white")).toEqual([
      { piece: "q", square: "a8", column: 0, row: 0 },
      { piece: "n", square: "a7", column: 0, row: 1 },
      { piece: "r", square: "a6", column: 0, row: 2 },
      { piece: "b", square: "a5", column: 0, row: 3 },
    ]);
  });

  it("follows a flipped board, on either edge file", () => {
    expect(promotionSquares("a8", "black").map((s) => [s.column, s.row])).toEqual([
      [7, 7],
      [7, 6],
      [7, 5],
      [7, 4],
    ]);
    expect(promotionSquares("h1", "black").map((s) => [s.square, s.column, s.row])).toEqual([
      ["h1", 0, 0],
      ["h2", 0, 1],
      ["h3", 0, 2],
      ["h4", 0, 3],
    ]);
    expect(promotionSquares("h1", "white")[0]).toMatchObject({ column: 7, row: 7 });
  });
});

describe("squareHighlights", () => {
  const none = {
    lastMove: null,
    selected: null,
    targets: [],
    fen: START_FEN,
    hover: null,
    check: null,
  };

  it("is empty with nothing to show, and tints only a whole last move", () => {
    expect(squareHighlights(none)).toEqual({});
    expect(squareHighlights({ ...none, lastMove: "e2" })).toEqual({});
  });

  it("layers check, selection, dots and rings over the last move's tint", () => {
    const styles = squareHighlights({
      ...none,
      lastMove: "e2e4",
      selected: "e4",
      targets: ["e5", "d7", "f5"],
      hover: "f5",
      check: "e8",
    });
    expect(styles.e2).toEqual({ backgroundColor: "var(--board-last-move)" });
    expect(styles.e4.backgroundColor).toBe("var(--board-last-move)");
    expect(styles.e4.backgroundImage).toContain("--board-selected");
    expect(styles.e5.backgroundImage).toContain("--board-move-dot");
    expect(styles.d7.backgroundImage).toContain("--board-move-ring");
    expect(styles.f5.backgroundImage).toContain("--board-hover");
    expect(styles.e8.backgroundImage).toContain("--board-check");
  });
});

describe("squaresChanged", () => {
  it("counts the squares two positions differ on", () => {
    const afterE4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    expect(squaresChanged(START_FEN, START_FEN)).toBe(0);
    expect(squaresChanged(START_FEN, afterE4)).toBe(2);
    expect(squaresChanged(START_FEN, "4k3/8/8/8/8/8/8/4K3 w - - 0 1")).toBe(30);
  });
});

describe("withAlpha", () => {
  it("fades hex and rgb colours, and anything else through color-mix", () => {
    expect(withAlpha("#0078f1", 0.5)).toBe("rgba(0, 120, 241, 0.5)");
    expect(withAlpha("rgb(1, 2, 3)", 0.5)).toBe("rgba(1, 2, 3, 0.5)");
    expect(withAlpha("oklch(0.5 0.1 200)", 0.5)).toBe(
      "color-mix(in srgb, oklch(0.5 0.1 200) 50%, transparent)",
    );
  });
});

describe("sanitizeDisplayPrefs", () => {
  it("keeps each valid field and defaults the rest on their own", () => {
    expect(sanitizeDisplayPrefs(undefined)).toEqual(DEFAULT_DISPLAY_PREFS);
    expect(sanitizeDisplayPrefs([])).toEqual(DEFAULT_DISPLAY_PREFS);
    expect(
      sanitizeDisplayPrefs({
        showMaterial: false,
        animation: "fast",
        moveInput: "drag",
        boardScale: 0.75,
        wheelSteps: "yes",
      }),
    ).toEqual({
      ...DEFAULT_DISPLAY_PREFS,
      showMaterial: false,
      animation: "fast",
      moveInput: "drag",
      boardScale: 0.75,
    });
    expect(sanitizeDisplayPrefs({ animation: "slow", moveInput: 1, boardScale: 2 })).toEqual(
      DEFAULT_DISPLAY_PREFS,
    );
    expect(sanitizeDisplayPrefs({ boardScale: 0.5 }).boardScale).toBe(1);
  });
});
