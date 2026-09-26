import { describe, expect, it, vi } from "vite-plus/test";
import { createApi, defaultProject } from "../src/api";
import { matchup, modelName, resultText, toGame, type ThreadItem } from "../src/games";
import { evalText, parseReview, reviewsByRun, whiteCp, whiteWinPercent } from "../src/review";
import { review, reviewFeedback, values } from "./support/fixtures";

const thread = (id: string, last = `${id}-last`): ThreadItem => ({
  thread_id: id,
  count: 2,
  min_start_time: "2026-09-25T12:00:00Z",
  max_start_time: "2026-09-25T12:05:00Z",
  last_trace_id: last,
});

describe("review", () => {
  it("parses only version 1 reviews", () => {
    expect(parseReview(review())).not.toBeNull();
    expect(parseReview(null)).toBeNull();
    expect(parseReview("x")).toBeNull();
    expect(parseReview({ version: 2, evals: [], plies: [] })).toBeNull();
    expect(parseReview({ version: 1, evals: [] })).toBeNull();
  });

  it("keeps this grader's reviews by run", () => {
    const reviews = reviewsByRun([
      reviewFeedback("a"),
      reviewFeedback("b", review(), "someone else"),
      reviewFeedback("c", { version: 0 }),
      { ...reviewFeedback("d"), key: "accuracy_white" },
      { ...reviewFeedback("e"), run_id: null },
      { key: "game_review", run_id: "f", value: review(), feedback_source: null },
      { key: "game_review", run_id: "g", value: review() },
    ]);
    expect([...reviews.keys()]).toEqual(["a"]);
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
    const full = toGame(thread("t"), run, review());
    expect(full).toMatchObject({ threadId: "t", lastRunId: "t-last", turns: 2, matchup: "m" });
    expect(full.values?.moves).toHaveLength(7);
    const bare = toGame(thread("t"), { ...run, outputs: { messages: [] } as never }, undefined);
    expect(bare.values).toBeNull();
    expect(bare.review).toBeNull();
    expect(toGame(thread("t"), undefined, undefined).matchup).toBe("Unknown setup");
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
    expect(page.games.map((g) => [g.threadId, g.values !== null, g.review !== null])).toEqual([
      ["a", true, true],
      ["b", false, false],
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
