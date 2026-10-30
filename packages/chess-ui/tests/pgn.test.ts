import { Chess } from "chess.js";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  copyText,
  evalTag,
  lichessUrl,
  LICHESS_URL_LIMIT,
  pgnResult,
  toPgn,
  type PgnMeta,
} from "../src/pgn";
import { START_FEN } from "../src/types";

const META: PgnMeta = {
  site: "http://localhost",
  date: new Date("2026-09-30T10:00:00Z"),
  white: "You",
  black: "Jev + GLM-5.3 Flash",
  comment: null,
};
const HEADERS = (result: string, extra = "", termination = "Unterminated") =>
  [
    '[Event "LangChain Chess"]',
    '[Site "http://localhost"]',
    '[Date "2026.09.30"]',
    '[Round "-"]',
    '[White "You"]',
    '[Black "Jev + GLM-5.3 Flash"]',
    `[Result "${result}"]`,
    ...(extra ? [extra] : []),
    `[Termination "${termination}"]`,
    '[Annotator "LangChain Chess"]',
  ].join("\n");

/** chess.js reads it back to the same moves. */
function readsBack(pgn: string, moves: readonly string[]) {
  const game = new Chess();
  game.loadPgn(pgn);
  expect(game.history({ verbose: true }).map((m) => m.lan)).toEqual(moves);
}

describe("toPgn", () => {
  it("writes a game from the standard start, in progress", () => {
    const moves = ["e2e4", "e7e5", "g1f3"];
    const pgn = toPgn({ startFen: START_FEN, moves, outcome: null, opening: null }, META);
    expect(pgn).toBe(`${HEADERS("*")}\n\n1. e4 e5 2. Nf3 *\n`);
    readsBack(pgn, moves);
  });

  it("starts from a custom FEN with Black to move and fullmove 12", () => {
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 3 12";
    const moves = ["g8f6", "b1c3", "f8c5"];
    const pgn = toPgn({ startFen: fen, moves, outcome: null, opening: null }, META);
    expect(pgn).toBe(`${HEADERS("*", `[SetUp "1"]\n[FEN "${fen}"]`)}\n\n12... Nf6 13. Nc3 Bc5 *\n`);
    const game = new Chess();
    game.loadPgn(pgn);
    expect(game.history()).toEqual(["Nf6", "Nc3", "Bc5"]);
  });

  it("scores a finished game: resigned, mated or drawn", () => {
    const resigned = toPgn(
      {
        startFen: START_FEN,
        moves: ["e2e4"],
        outcome: { kind: "resignation", winner: "white", reason: "resigned" },
        opening: null,
      },
      META,
    );
    expect(resigned).toBe(`${HEADERS("1-0", "", "Normal")}\n\n1. e4 1-0\n`);
    expect(pgnResult({ kind: "checkmate", winner: "black" })).toBe("0-1");
    expect(pgnResult({ kind: "draw", reason: "stalemate" })).toBe("1/2-1/2");
  });

  it("replays SAN a record is missing, and falls back to the UCI past a bad move", () => {
    const pgn = toPgn(
      {
        startFen: START_FEN,
        moves: ["e2e4", "e7e5", "e5e4"],
        sans: ["e4"],
        outcome: null,
        opening: null,
      },
      META,
    );
    expect(pgn).toContain("1. e4 e5 2. e5e4 *");
  });

  it("escapes header values and keeps comments intact", () => {
    const pgn = toPgn(
      { startFen: START_FEN, moves: [], outcome: null, opening: null },
      { ...META, date: null, white: 'A "quoted" \\ name', comment: "Opponent {x}\nThread t1" },
    );
    expect(pgn).toContain('[White "A \\"quoted\\" \\\\ name"]');
    expect(pgn).toContain('[Date "????.??.??"]');
    expect(pgn).toContain("{Opponent (x) Thread t1} *");
  });

  it("marks graded moves with NAGs and evaluations, mates as #n", () => {
    const moves = ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7"];
    const pgn = toPgn(
      {
        startFen: START_FEN,
        moves,
        outcome: { kind: "checkmate", winner: "white" },
        opening: null,
        grades: [
          { quality: "best", eval: { cp: 34 } },
          { quality: "good", eval: { cp: 30 } },
          { quality: "inaccuracy", eval: { cp: -5 } },
          { quality: "good", eval: { cp: 0 } },
          { quality: "good", eval: { cp: 10 } },
          { quality: "blunder", eval: { mate: 1, winner: "white" } },
          undefined,
        ],
      },
      META,
    );
    expect(pgn).toContain("1. e4 {[%eval 0.34]} 1... e5 {[%eval 0.30]} 2. Qh5 $6 {[%eval -0.05]}");
    expect(pgn).toContain("Nf6 $4 {[%eval #1]} 4. Qxf7# 1-0");
    readsBack(pgn, moves);
    expect(evalTag({ mate: 2, winner: "black" })).toBe("[%eval #-2]");
    expect(evalTag({ mate: 0, winner: "white" })).toBeNull();
    const mated = toPgn(
      {
        startFen: START_FEN,
        moves: ["e2e4"],
        outcome: null,
        opening: null,
        grades: [{ quality: "mistake", eval: { mate: 0, winner: "white" } }],
      },
      META,
    );
    expect(mated).toContain("1. e4 $2 *");
  });

  it("names the opening after the move that reached it, or before move 1 at the root", () => {
    const sicilian = { eco: "B20", name: "Sicilian Defense", reachedIndex: 2 };
    const reached = toPgn(
      { startFen: START_FEN, moves: ["e2e4", "c7c5", "g1f3"], outcome: null, opening: sicilian },
      META,
    );
    expect(reached).toContain("1. e4 c5 {B20 Sicilian Defense} 2. Nf3 *");
    const atBlack = toPgn(
      {
        startFen: START_FEN,
        moves: ["e2e4", "c7c5"],
        outcome: null,
        opening: { ...sicilian, reachedIndex: 1 },
      },
      META,
    );
    expect(atBlack).toContain("1. e4 {B20 Sicilian Defense} 1... c5 *");
    const root = toPgn(
      {
        startFen: START_FEN,
        moves: ["e2e4"],
        outcome: null,
        opening: { ...sicilian, reachedIndex: 0 },
      },
      META,
    );
    expect(root).toContain("{B20 Sicilian Defense} 1. e4 *");
  });

  it("wraps the movetext at 80 characters", () => {
    const moves = Array.from({ length: 20 }, (_, i) => ["g1f3", "g8f6", "f3g1", "f6g8"][i % 4]);
    const pgn = toPgn({ startFen: START_FEN, moves, outcome: null, opening: null }, META);
    const movetext = pgn.split("\n\n")[1].trimEnd().split("\n");
    expect(movetext.length).toBeGreaterThan(1);
    for (const line of movetext) expect(line.length).toBeLessThanOrEqual(80);
    readsBack(pgn, moves);
  });

  it("wraps long comments at their spaces, and keeps an eval command whole", () => {
    const name =
      "English Opening: King's English Variation, Four Knights Variation, Quiet Line, with a long tail";
    const moves = ["c2c4", "e7e5", "b1c3", "g8f6"];
    const pgn = toPgn(
      {
        startFen: START_FEN,
        moves,
        outcome: null,
        opening: { eco: "A29", name, reachedIndex: 2 },
        grades: [{ quality: "good", eval: { cp: 1234 } }],
      },
      { ...META, comment: `Reviewed by ${"a very thorough grader ".repeat(5).trim()}` },
    );
    const movetext = pgn.split("\n\n")[1].trimEnd().split("\n");
    for (const line of movetext) expect(line.length).toBeLessThanOrEqual(80);
    expect(pgn).toContain("{[%eval 12.34]}");
    const game = new Chess();
    game.loadPgn(pgn);
    expect(game.history({ verbose: true }).map((m) => m.lan)).toEqual(moves);
    expect(game.getComments().map((c) => c.comment)).toContain(`A29 ${name}`);
  });

  it("joins a position's comments into one, which chess.js reads back", () => {
    const moves = ["e2e4", "e7e5"];
    const root = toPgn(
      {
        startFen: START_FEN,
        moves,
        outcome: null,
        opening: { eco: "B00", name: "King's Pawn", reachedIndex: 0 },
      },
      { ...META, comment: "Reviewed." },
    );
    expect(root).toContain("{Reviewed. B00 King's Pawn} 1. e4");
    readsBack(root, moves);
    const graded = toPgn(
      {
        startFen: START_FEN,
        moves,
        outcome: null,
        opening: { eco: "C20", name: "King's Pawn Game", reachedIndex: 2 },
        grades: [undefined, { quality: "good", eval: { cp: 30 } }],
      },
      META,
    );
    expect(graded).toContain("1. e4 e5 {[%eval 0.30] C20 King's Pawn Game} *");
    readsBack(graded, moves);
  });

  it("writes a root typed with extra whitespace as one space between fields", () => {
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 3 12";
    const messy = `  ${fen.replaceAll(" ", " \t ")}  `;
    const pgn = toPgn({ startFen: messy, moves: ["g8f6"], outcome: null, opening: null }, META);
    expect(pgn).toContain(`[FEN "${fen}"]`);
    expect(pgn).toContain("12... Nf6 *");
    const standard = toPgn(
      { startFen: ` ${START_FEN} `, moves: [], outcome: null, opening: null },
      META,
    );
    expect(standard).not.toContain("[FEN");
  });
});

describe("lichessUrl", () => {
  it("sends the game, or the position when the game is too long for a link", () => {
    const short = lichessUrl("1. e4 *", START_FEN);
    expect(short).toEqual({
      url: `https://lichess.org/analysis/pgn/${encodeURIComponent("1. e4 *")}`,
      fallback: false,
    });
    const long = lichessUrl("x".repeat(LICHESS_URL_LIMIT), START_FEN);
    expect(long).toEqual({
      url: "https://lichess.org/analysis/rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR_w_KQkq_-_0_1",
      fallback: true,
    });
  });
});

describe("copyText", () => {
  it("says whether the clipboard took it", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    expect(await copyText("x", { writeText })).toBe(true);
    expect(writeText).toHaveBeenCalledWith("x");
    expect(await copyText("x", { writeText: () => Promise.reject(new Error("no")) })).toBe(false);
    expect(await copyText("x", undefined)).toBe(false);
  });
});
