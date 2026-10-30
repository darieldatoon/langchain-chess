import { DEFAULT_CONTEXT, START_FEN } from "@langchain-chess/chess-ui";
import { call, turn } from "@langchain-chess/chess-ui/testing";
import { describe, expect, it } from "vite-plus/test";
import { pgnFileName, pgnOf, playerName } from "../src/export";

const RECORD = {
  side: "black" as const,
  context: { ...DEFAULT_CONTEXT, k: 3 },
  startFen: START_FEN,
};

describe("pgnOf", () => {
  it("dates the game from its first call, names the players, and notes the setup", () => {
    const { game, meta } = pgnOf(
      {
        startFen: START_FEN,
        moves: ["e2e4"],
        plies: [{ san: "e4" }],
        turns: [turn({ calls: [call({ called_at: "2026-09-29T08:00:00Z" })] })],
        outcome: null,
        record: RECORD,
        threadId: "t1",
      },
      null,
      "https://chess.example",
    );
    expect(game).toMatchObject({ moves: ["e2e4"], sans: ["e4"], opening: null });
    expect(meta).toEqual({
      site: "https://chess.example",
      date: new Date("2026-09-29T08:00:00Z"),
      white: "Jev + GLM-5.3 Flash",
      black: "You",
      comment: "Jev + GLM-5.3 Flash · k 3 · Thread t1",
    });
  });

  it("has no date, names or note for a game with no calls, record or thread", () => {
    const { meta } = pgnOf(
      {
        startFen: START_FEN,
        moves: [],
        plies: [],
        turns: [turn()],
        outcome: null,
        record: null,
        threadId: null,
      },
      null,
      "x",
    );
    expect(meta).toMatchObject({ date: null, white: "White", black: "Black", comment: null });
  });
});

describe("names", () => {
  it("calls the human You and names the file after the thread", () => {
    expect(playerName(RECORD, "black")).toBe("You");
    expect(pgnFileName("t1")).toBe("langchain-chess-t1.pgn");
    expect(pgnFileName(null)).toBe("langchain-chess.pgn");
  });
});
