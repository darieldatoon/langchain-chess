import { describe, expect, it, vi } from "vite-plus/test";
import { appended, createApi, defaultProject, firstPages, threadUrl } from "../src/api";
import { matchup, modelName, resultText, sideLabel, toGame, type ThreadItem } from "../src/games";
import {
  EMPTY,
  evalText,
  parseReview,
  readReview,
  reviewsByRun,
  whiteCp,
  whiteWinPercent,
} from "../src/review";
import { decodeValues } from "../src/values";
import { reviewPgn } from "../src/export";
import { toPgn } from "@langchain-chess/chess-ui";
import {
  call as llmCall,
  live,
  ply as plyOf,
  systemOne,
  turn,
} from "@langchain-chess/chess-ui/testing";
import {
  game,
  graded,
  MOVES,
  partFeedback,
  review,
  reviewFeedback,
  values,
  versionTwo,
} from "./support/fixtures";

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
      [{ ...good, version: 3 }, "version 3 is not supported"],
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

  it("joins a version 2 header's parts into the review", () => {
    const { header, parts } = versionTwo();
    expect(readReview(header, [parts[1], parts[0]])).toEqual(graded());
    const other = versionTwo(review(), [7], "g0").parts;
    expect(readReview(header, [...other, ...parts]).status).toBe("graded");
  });

  it("says what is wrong with a version 2 review", () => {
    const { header, parts } = versionTwo();
    const [first, second] = parts;
    const cases: [unknown, unknown[], string][] = [
      [null, parts, EMPTY],
      ["x", parts, "it is not an object"],
      [{ ...header, generation: 1 }, parts, "its header is malformed"],
      [{ ...header, parts: "2" }, parts, "its header is malformed"],
      [{ ...header, plies: null }, parts, "its header is malformed"],
      [header, [first], "part 2 of 2 is missing"],
      [header, [first, { ...second, generation: "g0" }], "part 2 of 2 is missing"],
      [header, [first, null, second, { ...second }], "it is valid"],
      [header, [first, { ...second, version: 3 }], "part 1 has an unsupported version"],
      [header, [first, second, { ...second, from: 9 }], "part 1 is stored twice, differently"],
      [header, [first, { ...second, from: 2 }], "part 2 of 2 is malformed"],
      [header, [first, { ...second, plies: {} }], "part 2 of 2 is malformed"],
      [header, [first, { ...second, evals: null }], "part 2 of 2 is malformed"],
      [header, [first, { ...second, evals: [] }], "part 2 of 2 is malformed"],
      [{ ...header, plies: 8 }, parts, "its parts hold 7 of its 8 plies"],
      [{ ...header, final_eval: undefined }, parts, "evaluation 7 is malformed"],
    ];
    for (const [value, stored, problem] of cases) {
      const expected = problem === "it is valid" ? graded() : { status: "invalid", problem };
      expect(readReview(value, stored), problem).toEqual(expected);
    }
  });

  it("reads the newest header of a run, and parts only with a header", () => {
    const old = versionTwo(review(), [7], "g0");
    const fresh = versionTwo(review({ accuracy: { white: 1, black: 2 } }), [7], "g1");
    const reviews = reviewsByRun([
      reviewFeedback("a", old.header),
      reviewFeedback("a", fresh.header, undefined, "2026-09-25T12:40:00.000001Z"),
      reviewFeedback("a", old.header, undefined, "2026-09-25T12:40:00Z"),
      reviewFeedback("a", old.header, undefined, "not a time"),
      partFeedback("a", old.parts[0]),
      partFeedback("a", fresh.parts[0]),
      partFeedback("a", { junk: true }, "someone else"),
      partFeedback("b", fresh.parts[0]),
      { ...reviewFeedback("c", null), created_at: undefined },
      { ...reviewFeedback("c", review()), created_at: undefined },
    ]);
    expect([...reviews.keys()]).toEqual(["a", "c"]);
    expect(reviews.get("a")).toEqual(graded({ accuracy: { white: 1, black: 2 } }));
    expect(reviews.get("c")).toEqual({ status: "invalid", problem: EMPTY });
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
    for (const reason of ["illegal_moves", "resigned"]) {
      const resigned = { kind: "resignation", winner: "white", reason };
      expect(decodeValues({ moves: [], outcome: resigned })).not.toBeNull();
    }
    const offers = [{ ply: 0, by: "white", answer: "declined" }];
    expect(decodeValues({ moves: [], draw_offers: offers })).not.toBeNull();
    expect(decodeValues({ moves: [], systemone_live: live() })).not.toBeNull();
    expect(decodeValues({ moves: [], systemone_live: null })).not.toBeNull();
    // Older metadata has no gate facts, or no time.
    expect(decodeValues(withS1({ signal: undefined, latency_ms: undefined }))).not.toBeNull();
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
      { moves: [], outcome: { kind: "resignation", winner: "white", reason: "bored" } },
      { moves: [], outcome: { kind: "resignation", winner: "red", reason: "resigned" } },
      { moves: [], draw_offers: {} },
      { moves: [], draw_offers: [{ ply: 1.5, by: "white", answer: "declined" }] },
      { moves: [], draw_offers: [{ ply: 1, by: "red", answer: "declined" }] },
      { moves: [], draw_offers: [{ ply: 1, by: "white", answer: "accepted" }] },
      { moves: [], draw_offers: [null] },
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
      withS1({ signal: "high" }),
      withS1({ threshold_used: "0.9" }),
      withS1({ gate: 1 }),
      withS1({ latency_ms: "slow" }),
      { moves: [], systemone_live: "x" },
      { moves: [], systemone_live: { ...live(), turn_id: 1 } },
      { moves: [], systemone_live: { ...live(), status: "thinking" } },
      { moves: [], systemone_live: { ...live(), latency_ms: undefined } },
      { moves: [], systemone_live: { ...live(), calls: [null] } },
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
    expect(full.surface).toBeNull();
    const web = toGame(thread("t"), { ...run, metadata: { policy: "llm", surface: "web" } });
    expect(web.surface).toBe("web");
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

  it("reads every page of a page of games' feedback, headers apart from parts", async () => {
    const { header, parts } = versionTwo(review(), [1, 1, 1, 1, 1, 1, 1]);
    const filler = Array.from({ length: 96 }, (_, i) => ({
      ...partFeedback("b-last", null, "someone else"),
      id: `filler-${i}`,
    }));
    const stored = [
      ...filler,
      ...parts.map((p, i) => ({ ...partFeedback("a-last", p), id: `part-${i}` })),
    ];
    const listed: string[] = [];
    const call = vi.fn(async (operation: string, args?: { params?: Record<string, unknown> }) => {
      if (operation === "POST /api/v2/threads/query") return { items: [thread("a")] };
      if (operation === "POST /api/v2/runs/query") return { items: [] };
      const { key, offset } = args!.params as { key: string[]; offset: string };
      listed.push(`${key.join("+")}@${offset}`);
      if (!key.includes("game_review_part")) return [reviewFeedback("a-last", header)];
      // A row seen at the end of the first page comes again at the start of the second.
      return Number(offset) ? stored.slice(99) : stored.slice(0, 100);
    });
    const page = await createApi(call).games("p1", "2026-09-18T00:00:00Z");
    expect(listed).toEqual([
      "game_review+grade_status@0",
      "game_review_part@0",
      "game_review_part@100",
    ]);
    expect(page.games[0].grading).toEqual(graded());
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

  it("links the game's thread from the run's URL, resolved on the server", async () => {
    const call = vi
      .fn()
      .mockResolvedValue({ url: "https://smith/o/org/projects/p/p1/trace/r1/run/r1" });
    const target = { threadId: "t1", runId: "r1", runStartTime: null };
    expect(await createApi(call).traceUrl("p1", target)).toBe(
      "https://smith/o/org/projects/p/p1/t/t1?run_id=r1&conversationTab=trace&scroll_to=output",
    );
    expect(call).toHaveBeenCalledWith("GET /api/v2/runs/r1/url", {
      params: { project_id: "p1", trace_id: "r1" },
    });
  });
});

describe("threadUrl", () => {
  const target = { threadId: "t1", runId: "r1", runStartTime: "2026-09-29T03:48:21.418426Z" };

  it("opens the thread's Trace tab at the run's output, from its start time", () => {
    expect(
      threadUrl("https://smith.langchain.com/o/org/projects/p/p1/trace/r1/run/r1", target),
    ).toBe(
      "https://smith.langchain.com/o/org/projects/p/p1/t/t1?run_id=r1&conversationTab=trace" +
        "&scroll_to=output&start_time=2026-09-29T03%3A48%3A21.418426Z",
    );
  });

  it("keeps a self-hosted deployment's base path and drops the run link's query", () => {
    expect(
      threadUrl("https://ls.corp/app/o/org/projects/p/p1/trace/r1/run/r1?start_time=x", {
        ...target,
        threadId: "a b",
        runStartTime: null,
      }),
    ).toBe(
      "https://ls.corp/app/o/org/projects/p/p1/t/a%20b?run_id=r1&conversationTab=trace&scroll_to=output",
    );
  });

  it("falls back to the run's link when it isn't in the expected form", () => {
    for (const url of [
      "https://smith/public/abc/r",
      "https://smith/o/org/projects/p/p1",
      "/relative",
    ])
      expect(threadUrl(url, target)).toBe(url);
  });
});

describe("sideLabel", () => {
  const plies = values().plies!;
  const agent = plies.find((p) => p.source !== "external")!.side;
  const other = agent === "white" ? "black" : "white";

  it("names an agent side by the matchup, from the whole game", () => {
    expect(sideLabel({ matchup: "m", surface: null }, plies, agent)).toBe("m");
  });

  it("names a side with only external moves Human for a web game, else by colour", () => {
    const external = plies.map((p) => ({ ...p, source: "external" }));
    expect(sideLabel({ matchup: "m", surface: "web" }, external, other)).toBe("Human");
    expect(sideLabel({ matchup: "m", surface: "tui" }, external, "white")).toBe("White");
    expect(sideLabel({ matchup: "m", surface: null }, [], "black")).toBe("Black");
  });
});

describe("reviewPgn", () => {
  it("writes an ungraded game with no plies from its moves alone", () => {
    const { game: pgn, meta } = reviewPgn(game(), { moves: ["e2e4"] }, null, null);
    expect(pgn).toMatchObject({
      moves: ["e2e4"],
      sans: [undefined],
      outcome: null,
      grades: undefined,
    });
    expect(meta).toMatchObject({ site: "LangSmith", white: "Human", black: "Human" });
    expect(meta.comment).toBe("claude-opus-5-5 + semif-qwen3.5-4b · Thread thread-1");
    expect(reviewPgn(game(), {}, null, null).game.moves).toEqual([]);
  });

  it("places each record's SAN at its own ply, so missing ones are replayed", () => {
    const sparse = values({ plies: values().plies!.filter((p) => p.ply !== 0 && p.ply !== 3) });
    const { game: pgn, meta } = reviewPgn(game(), sparse, review(), null);
    expect(pgn.sans).toEqual([undefined, "e5", "Qh5", undefined, "Bc4", "Nf6", "Qxf7#"]);
    const movetext = toPgn(pgn, meta)
      .split("\n\n")[1]
      .replace(/\{[^}]*\}/g, " ");
    const played = movetext
      .split(/\s+/)
      .filter((t) => t && !/^\d+\.+$/.test(t) && !t.startsWith("$") && t !== "1-0");
    expect(played).toEqual(["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7#"]);
  });
});
