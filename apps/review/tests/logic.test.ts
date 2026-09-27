import { describe, expect, it, vi } from "vite-plus/test";
import { appended, createApi, defaultProject, firstPages } from "../src/api";
import { matchup, modelName, resultText, toGame, type ThreadItem } from "../src/games";
import { evalText, parseReview, reviewsByRun, whiteCp, whiteWinPercent } from "../src/review";
import { decodeValues } from "../src/values";
import { call as llmCall, ply as plyOf, systemOne, turn } from "@langchain-chess/chess-ui/testing";
import { game, graded, MOVES, review, reviewFeedback, values } from "./support/fixtures";

const thread = (id: string, last = `${id}-last`): ThreadItem => ({
  thread_id: id,
  count: 2,
  min_start_time: "2026-09-25T12:00:00Z",
  max_start_time: "2026-09-25T12:05:00Z",
  last_trace_id: last,
});

describe("review", () => {
  it("accepts a complete version 1 review", () => {
    const value = review({ settings: {}, accuracy: { white: null, black: null } });
    expect(parseReview(value)).toEqual({ status: "graded", review: value });
    const mated = review({ evals: [{ mate: 0, winner: "black" }], plies: [] });
    expect(parseReview(mated).status).toBe("graded");
    const nulls = review().plies.map((p) => ({ ...p, best_move: null, lines: [] }));
    expect(parseReview(review({ plies: nulls })).status).toBe("graded");
  });

  it("says what is wrong with a malformed review", () => {
    const good = review();
    const ply = good.plies[0];
    const withPly = (p: unknown) => ({ ...good, plies: [p, ...good.plies.slice(1)] });
    const cases: [unknown, string][] = [
      [null, "it is not an object"],
      [[], "it is not an object"],
      [{ ...good, version: 2 }, "version 2 is not supported"],
      [{ ...good, version: { toString: null } }, "the version is missing or malformed"],
      [{ ...good, version: undefined }, "the version is missing or malformed"],
      [{ ...good, engine: undefined }, "the engine is missing"],
      [{ ...good, settings: null }, "the settings are malformed"],
      [{ ...good, settings: { multipv: "2" } }, "the settings are malformed"],
      [{ ...good, accuracy: 90 }, "the accuracy is malformed"],
      [{ ...good, accuracy: { white: "90", black: null } }, "the accuracy is malformed"],
      [{ ...good, accuracy: { white: 90 } }, "the accuracy is malformed"],
      [{ ...good, evals: undefined }, "the evaluations are missing"],
      [{ ...good, evals: [{ cp: 1 }, "x"] }, "evaluation 1 is malformed"],
      [{ ...good, evals: [{ cp: Number.NaN }] }, "evaluation 0 is malformed"],
      [{ ...good, evals: [{ mate: 1.5, winner: "white" }] }, "evaluation 0 is malformed"],
      [{ ...good, evals: [{ mate: 1, winner: "nobody" }] }, "evaluation 0 is malformed"],
      [{ ...good, plies: {} }, "the move grades are missing"],
      [withPly(null), "the grade of ply 0 is malformed"],
      [withPly({ ...ply, ply: 1 }), "the grade of ply 0 is malformed"],
      [withPly({ ...ply, run_id: null }), "the grade of ply 0 is malformed"],
      [withPly({ ...ply, side: "red" }), "the grade of ply 0 is malformed"],
      [withPly({ ...ply, uci: 1 }), "the grade of ply 0 is malformed"],
      [withPly({ ...ply, best_move: 1 }), "the grade of ply 0 is malformed"],
      [withPly({ ...ply, quality: "brilliant" }), "the grade of ply 0 is malformed"],
      [withPly({ ...ply, accuracy: null }), "the grade of ply 0 is malformed"],
      [withPly({ ...ply, lines: null }), "the grade of ply 0 is malformed"],
      [withPly({ ...ply, lines: [null] }), "the grade of ply 0 is malformed"],
      [withPly({ ...ply, lines: [{ eval: {}, pv: [] }] }), "the grade of ply 0 is malformed"],
      [
        withPly({ ...ply, lines: [{ eval: { cp: 1 }, pv: "e2e4" }] }),
        "the grade of ply 0 is malformed",
      ],
      [
        withPly({ ...ply, lines: [{ eval: { cp: 1 }, pv: [1] }] }),
        "the grade of ply 0 is malformed",
      ],
      [{ ...good, evals: good.evals.slice(1) }, "there is not one evaluation per position"],
    ];
    for (const [value, problem] of cases) {
      expect(parseReview(value), problem).toEqual({ status: "invalid", problem });
    }
  });

  it("keeps this grader's reviews by run, and reports its unreadable ones", () => {
    const reviews = reviewsByRun([
      reviewFeedback("a"),
      reviewFeedback("b", review(), "someone else"),
      reviewFeedback("c", { version: 0 }),
      { ...reviewFeedback("d"), key: "accuracy_white" },
      { ...reviewFeedback("e"), run_id: null },
      { key: "game_review", run_id: "f", value: review(), feedback_source: null },
      { key: "game_review", run_id: "g", value: review() },
    ]);
    expect([...reviews.keys()]).toEqual(["a", "c"]);
    expect(reviews.get("a")?.status).toBe("graded");
    expect(reviews.get("c")).toEqual({ status: "invalid", problem: "version 0 is not supported" });
  });

  it("scores from White's side with mates at the ceiling", () => {
    expect(whiteCp({ cp: 5000 })).toBe(1000);
    expect(whiteCp({ cp: -30 })).toBe(-30);
    expect(whiteCp({ mate: 2, winner: "black" })).toBe(-1000);
    expect(whiteWinPercent({ cp: 0 })).toBe(50);
    expect(whiteWinPercent({ mate: 0, winner: "white" })).toBeCloseTo(97.5, 1);
  });

  it("writes evals as pawns, mates, or the result", () => {
    expect(evalText({ cp: 34 })).toBe("+0.3");
    expect(evalText({ cp: -120 })).toBe("-1.2");
    expect(evalText({ cp: 0 })).toBe("0.0");
    expect(evalText({ mate: 3, winner: "white" })).toBe("#3");
    expect(evalText({ mate: 2, winner: "black" })).toBe("-#2");
    expect(evalText({ mate: 0, winner: "white" })).toBe("1-0");
    expect(evalText({ mate: 0, winner: "black" })).toBe("0-1");
  });
});

describe("values", () => {
  const S1 = "SystemOneMiddleware";
  const good = values({
    plies: [plyOf({ meta: { [S1]: { ...systemOne() } } }), ...values().plies!.slice(1)],
    turns: [turn({ id: "turn-1", calls: [llmCall(), llmCall({ cost_usd: null })] })],
  });
  const withPly = (overrides: object) => ({
    ...good,
    plies: [{ ...good.plies![0], ...overrides }, ...good.plies!.slice(1)],
  });
  const withS1 = (overrides: object) =>
    withPly({ meta: { [S1]: { ...systemOne(), ...overrides } } });
  const withTurn = (overrides: object) => ({ ...good, turns: [{ ...turn(), ...overrides }] });

  it("decodes a game record, optional parts absent or blank", () => {
    expect(decodeValues(good)).toBe(good);
    expect(decodeValues({ moves: [] })).not.toBeNull();
    const draw = { kind: "draw", reason: "threefold" };
    expect(decodeValues({ moves: ["e2e4"], start_fen: "", outcome: draw })).not.toBeNull();
    expect(decodeValues({ ...good, outcome: null })).not.toBeNull();
    expect(decodeValues(withPly({ analysis: undefined, meta: { [S1]: {} } }))).not.toBeNull();
    expect(decodeValues(withS1({ top: undefined, error: "timeout" }))).not.toBeNull();
    expect(decodeValues(withS1({ played_move_result: null }))).not.toBeNull();
  });

  it("finds no game record in anything else", () => {
    const bad: unknown[] = [
      null,
      [],
      { messages: [] },
      { moves: [{ from: "a", to: "b" }] },
      { moves: ["e2e9"] },
      { moves: [], start_fen: "not a fen" },
      { moves: [], start_fen: 3 },
      { moves: [], outcome: "1-0" },
      { moves: [], outcome: { kind: "draw", reason: "boredom" } },
      { moves: [], outcome: { kind: "draw", reason: 1 } },
      { moves: [], outcome: { kind: "checkmate", winner: "nobody" } },
      { moves: [], outcome: { kind: "timeout", winner: "white" } },
      { ...good, plies: {} },
      { ...good, plies: [null] },
      withPly({ uci: 1 }),
      withPly({ san: null }),
      withPly({ source: 2 }),
      withPly({ latency_ms: "fast" }),
      withPly({ model: 3 }),
      withPly({ meta: null }),
      withS1({ status: "thinking" }),
      withS1({ error: 1 }),
      withS1({ shortlist: undefined }),
      withS1({ shortlist: [{ uci: "e2e4" }] }),
      withS1({ top: [null] }),
      withS1({ played_move_result: [{ heat: "hot", bye: false, probability: 1 }] }),
      withS1({ played_move_result: [{ heat: null, bye: "no", probability: 1 }] }),
      withS1({ played_move_result: [null] }),
      { ...good, turns: "none" },
      withTurn({ id: 1 }),
      withTurn({ illegal_attempts: null }),
      withTurn({ calls: [null] }),
      withTurn({ calls: [{ ...llmCall(), reasoning_tokens: null }] }),
      withTurn({ calls: [{ ...llmCall(), cost_usd: "free" }] }),
      withTurn({ calls: [{ ...llmCall(), cost_complete: 1 }] }),
    ];
    for (const [i, outputs] of bad.entries()) expect(decodeValues(outputs), `case ${i}`).toBeNull();
  });
});

describe("games", () => {
  it("names models from their specs", () => {
    expect(modelName("langsmith:anthropic/claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(modelName("typesafe/jev-latest")).toBe("jev-latest");
    expect(modelName("")).toBeNull();
    expect(modelName(3)).toBeNull();
  });

  it("describes the matchup by policy", () => {
    const models = { model: "anthropic:claude-opus-5-5", systemone_model: "semif-qwen3.5-4b" };
    expect(matchup({ policy: "llm", ...models })).toBe("claude-opus-5-5");
    expect(matchup({ policy: "llm" })).toBe("LLM");
    expect(matchup({ policy: "systemone", ...models })).toBe("semif-qwen3.5-4b");
    expect(matchup({ policy: "systemone" })).toBe("System 1");
    expect(matchup({ policy: "hybrid", ...models })).toBe("claude-opus-5-5 + semif-qwen3.5-4b");
    expect(matchup({ policy: "hybrid" })).toBe("Hybrid");
    expect(matchup(null)).toBe("Unknown setup");
  });

  it("writes results", () => {
    expect(resultText(null)).toBe("In progress");
    expect(resultText(undefined)).toBe("In progress");
    expect(resultText({ kind: "draw", reason: "stalemate" })).toBe("½-½");
    expect(resultText({ kind: "checkmate", winner: "white" })).toBe("1-0");
    expect(resultText({ kind: "resignation", winner: "black", reason: "illegal_moves" })).toBe(
      "0-1",
    );
  });

  it("builds a game, without a record when the run has none", () => {
    const run = {
      id: "t-last",
      trace_id: "t-last",
      start_time: "",
      metadata: { policy: "llm", model: "m" },
      outputs: values(),
    };
    const full = toGame(thread("t"), run, graded());
    expect(full).toMatchObject({ threadId: "t", lastRunId: "t-last", turns: 2, matchup: "m" });
    expect(full.values?.moves).toHaveLength(7);
    expect(full.grading.status).toBe("graded");
    const bare = toGame(thread("t"), { ...run, outputs: { messages: [] } as never }, graded());
    expect(bare.values).toBeNull();
    expect(bare.grading.status).toBe("graded");
    const none = toGame(thread("t"), undefined);
    expect(none.matchup).toBe("Unknown setup");
    expect(none.grading).toEqual({ status: "ungraded" });
  });

  it("rejects a review of other moves than the game's", () => {
    const run = { id: "r", trace_id: "r", start_time: "", metadata: null, outputs: values() };
    const mismatch = { status: "invalid", problem: "it grades different moves than the game's" };
    const shorter = values({ moves: MOVES.slice(0, 6) });
    expect(toGame(thread("t"), { ...run, outputs: shorter }, graded()).grading).toEqual(mismatch);
    const other = values({ moves: [...MOVES.slice(0, 6), "h5e8"] });
    expect(toGame(thread("t"), { ...run, outputs: other }, graded()).grading).toEqual(mismatch);
    const invalid = { status: "invalid", problem: "x" } as const;
    expect(toGame(thread("t"), run, invalid).grading).toBe(invalid);
  });
});

describe("pages", () => {
  const page = (ids: string[], cursor: string | null) => ({
    games: ids.map((threadId) => game({ threadId })),
    cursor,
  });
  const ids = (p: { games: { threadId: string }[] }) => p.games.map((g) => g.threadId);

  it("loads the first pages one after another, stopping at the last", async () => {
    const games = vi
      .fn()
      .mockResolvedValueOnce(page(["c", "b"], "after-b"))
      .mockResolvedValueOnce(page(["a"], null));
    const loaded = await firstPages({ games }, "p", "since", 3);
    expect(ids(loaded)).toEqual(["c", "b", "a"]);
    expect(loaded.cursor).toBeNull();
    expect(games.mock.calls).toEqual([
      ["p", "since"],
      ["p", "since", "after-b"],
    ]);
  });

  it("loads past the page count until the open game is back", async () => {
    const games = vi
      .fn()
      .mockResolvedValueOnce(page(["new", "c"], "after-c"))
      .mockResolvedValueOnce(page(["b", "a"], "after-a"))
      .mockResolvedValueOnce(page(["open"], "after-open"));
    const loaded = await firstPages({ games }, "p", "since", 2, "open");
    expect(ids(loaded)).toEqual(["new", "c", "b", "a", "open"]);
    expect(loaded.pages).toBe(3);
    expect(games).toHaveBeenCalledTimes(3);
  });

  it("lists a game once when it moved up to the page before", () => {
    const next = appended(page(["c", "b", "a"], "after-b"), page(["a", "z"], null));
    expect(ids(next)).toEqual(["c", "b", "a", "z"]);
    expect(next.cursor).toBeNull();
  });
});

describe("api", () => {
  it("picks the deployment's project, then a chess one, then the first", () => {
    const p = (id: string, name: string) => ({ id, name });
    expect(
      defaultProject([p("1", "x"), p("2", "chess-local"), p("3", "langchain-chess-app")]),
    ).toBe("3");
    expect(defaultProject([p("1", "x"), p("2", "chess-local")])).toBe("2");
    expect(defaultProject([p("1", "x")])).toBe("1");
    expect(defaultProject([])).toBeNull();
  });

  it("lists projects", async () => {
    const call = vi.fn().mockResolvedValue([{ id: "1", name: "a", extra: true }]);
    expect(await createApi(call).projects()).toEqual([{ id: "1", name: "a" }]);
    expect(call.mock.calls[0][0]).toBe("GET /api/v1/sessions");
  });

  it("loads the page when a review is malformed, marking just that review", async () => {
    const call = vi.fn(async (operation: string): Promise<unknown> => {
      if (operation === "POST /api/v2/threads/query") return { items: [thread("a")] };
      if (operation === "POST /api/v2/runs/query") return { items: [] };
      return [reviewFeedback("a-last", JSON.parse('{"version":{"toString":null}}'))];
    });
    const page = await createApi(call).games("p1", "2026-09-18T00:00:00Z");
    expect(page.games.map((g) => g.grading)).toEqual([
      { status: "invalid", problem: "the version is missing or malformed" },
    ]);
  });

  it("pages games with their last runs and reviews", async () => {
    const call = vi.fn(async (operation: string, args?: { body?: unknown }) => {
      if (operation === "POST /api/v2/threads/query") {
        const cursor = (args?.body as { cursor?: string } | undefined)?.cursor;
        return cursor
          ? { items: [], next_cursor: null }
          : { items: [thread("a"), thread("b")], next_cursor: "next" };
      }
      if (operation === "POST /api/v2/runs/query") {
        return {
          items: [
            { id: "a-last", trace_id: "a-last", start_time: "", metadata: {}, outputs: values() },
          ],
        };
      }
      return [reviewFeedback("a-last")];
    });
    const api = createApi(call);
    const page = await api.games("p1", "2026-09-18T00:00:00Z");
    expect(page.cursor).toBe("next");
    expect(page.games.map((g) => [g.threadId, g.values !== null, g.grading.status])).toEqual([
      ["a", true, "graded"],
      ["b", false, "ungraded"],
    ]);
    const runsQuery = call.mock.calls.find(([op]) => op === "POST /api/v2/runs/query");
    expect(runsQuery?.[1]).toMatchObject({
      body: { ids: ["a-last", "b-last"], min_start_time: "2026-09-18T00:00:00Z", is_root: true },
    });
    expect(await api.games("p1", "2026-09-18T00:00:00Z", "next")).toEqual({
      games: [],
      cursor: null,
    });
    expect(call.mock.calls.at(-1)?.[1]).toMatchObject({ body: { cursor: "next" } });
  });

  it("resolves a run's URL on the server", async () => {
    const call = vi.fn().mockResolvedValue({ url: "https://smith/o/w/trace" });
    expect(await createApi(call).runUrl("p1", "r1")).toBe("https://smith/o/w/trace");
    expect(call).toHaveBeenCalledWith("GET /api/v2/runs/r1/url", {
      params: { project_id: "p1", trace_id: "r1" },
    });
  });
});
