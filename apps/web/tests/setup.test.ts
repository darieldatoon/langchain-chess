import { describe, expect, it } from "vite-plus/test";
import {
  changedKnobs,
  DEFAULT_SETUP,
  gameOf,
  knobsOf,
  matchupLine,
  matchupOf,
  modelName,
  opponentLabel,
  resolveSide,
  sanitizeSetup,
  sectionsOf,
  setupFromContext,
  type Setup,
} from "../src/setup";
import { DEFAULT_CONTEXT, type ChessContext } from "@langchain-chess/chess-ui";
import { E4_E5, ply, turn } from "@langchain-chess/chess-ui/testing";

const setup = (overrides: Partial<Setup> = {}): Setup => ({ ...DEFAULT_SETUP, ...overrides });

function contextOf(s: Setup): ChessContext {
  const matchup = matchupOf(s, "yes");
  if (!matchup.ok) throw new Error(matchup.reason);
  return matchup.context;
}

describe("matchupOf", () => {
  it("derives the policy from the two pickers", () => {
    expect(contextOf(setup())).toEqual(DEFAULT_CONTEXT);
    expect(contextOf(setup({ llm: "none" }))).toMatchObject({
      policy: "systemone",
      systemone_model: "semif-qwen3.5-4b",
    });
    expect(
      contextOf(setup({ systemOne: "none", llm: "langsmith:baseten/zai-org/GLM-5.3" })),
    ).toMatchObject({
      policy: "llm",
      model: "langsmith:baseten/zai-org/GLM-5.3",
    });
    expect(contextOf(setup({ systemOne: "typesafe/jev-latest" }))).toMatchObject({
      policy: "hybrid",
      systemone_model: "typesafe/jev-latest",
      model: "langsmith:baseten/zai-org/GLM-5.3-Flash",
    });
  });

  it("refuses both None and an empty custom model", () => {
    expect(matchupOf(setup({ systemOne: "none", llm: "none" }), "yes")).toEqual({
      ok: false,
      reason: "Pick a System 1, an LLM, or both.",
    });
    expect(matchupOf(setup({ llm: "custom", customModel: "  " }), "yes")).toEqual({
      ok: false,
      reason: "Enter a model spec for the custom LLM.",
    });
  });

  it("summarizes only with a model that can, and waits for the answer", () => {
    const summarizing = setup({ knobs: { ...DEFAULT_SETUP.knobs, memory: "summarize" } });
    expect(matchupOf(summarizing, "yes")).toMatchObject({ context: { memory: "summarize" } });
    expect(matchupOf(summarizing, "no")).toMatchObject({ context: { memory: "none" } });
    expect(matchupOf(summarizing, "checking")).toEqual({
      ok: false,
      reason: "Checking whether GLM-5.3 Flash can summarize…",
    });
    expect(matchupOf(summarizing, "unknown")).toEqual({
      ok: false,
      reason: "Couldn't check whether GLM-5.3 Flash can summarize.",
    });
    expect(matchupOf(setup(), "checking")).toMatchObject({ ok: true });
    expect(matchupOf(setup(), "unknown")).toMatchObject({ ok: true });
    const alone = { ...summarizing, llm: "none" as const };
    expect(matchupOf(alone, "checking")).toMatchObject({ ok: true });
  });

  it("sends a custom model trimmed, and carries the knobs", () => {
    const knobs = { ...DEFAULT_SETUP.knobs, threshold: 0.4, k: 3 };
    const context = contextOf(
      setup({ llm: "custom", customModel: " langsmith:baseten/zai-org/GLM-5.3-Flash ", knobs }),
    );
    expect(context).toEqual({
      ...DEFAULT_CONTEXT,
      model: "langsmith:baseten/zai-org/GLM-5.3-Flash",
      threshold: 0.4,
      k: 3,
    });
  });
});

describe("matchup wording", () => {
  it("describes the matchup in plain words", () => {
    expect(matchupLine(DEFAULT_CONTEXT)).toBe(
      "SemIf plays confident moves; GLM-5.3 Flash decides the rest.",
    );
    expect(matchupLine({ ...DEFAULT_CONTEXT, policy: "systemone" })).toBe(
      "SemIf plays every move.",
    );
    expect(matchupLine({ ...DEFAULT_CONTEXT, policy: "llm", model: "openai:gpt-5.6-sol" })).toBe(
      "openai:gpt-5.6-sol plays every move.",
    );
  });

  it("labels the opponent with the effort only when an LLM plays", () => {
    expect(opponentLabel(DEFAULT_CONTEXT)).toBe("SemIf + GLM-5.3 Flash");
    expect(
      opponentLabel({
        ...DEFAULT_CONTEXT,
        policy: "systemone",
        systemone_model: "typesafe/jev-latest",
      }),
    ).toBe("Jev");
    expect(
      opponentLabel({
        ...DEFAULT_CONTEXT,
        policy: "llm",
        model: "langsmith:openai/gpt-6-luna",
        reasoning_effort: "high",
      }),
    ).toBe("GPT-6 Luna · high");
    expect(modelName("langsmith:baseten/zai-org/GLM-5.3")).toBe("GLM-5.3");
    expect(modelName("openai:gpt-5.6-sol")).toBe("openai:gpt-5.6-sol");
  });

  it("lists only the changed knobs the policy uses", () => {
    expect(changedKnobs(DEFAULT_CONTEXT)).toEqual([]);
    const tuned: ChessContext = {
      ...DEFAULT_CONTEXT,
      threshold: 0.5,
      show_legal_moves: false,
      with_eval: true,
      draw_claims: "never",
      reasoning_effort: "high",
    };
    expect(changedKnobs(tuned)).toEqual([
      "show legal moves off",
      "with eval on",
      "threshold 0.5",
      "draw claims never",
    ]);
    expect(changedKnobs({ ...tuned, policy: "systemone" })).toEqual([
      "with eval on",
      "draw claims never",
    ]);
    expect(changedKnobs({ ...tuned, policy: "llm" })).toEqual([
      "show legal moves off",
      "draw claims never",
    ]);
  });
});

describe("sectionsOf", () => {
  it("shows the gate only when both pickers are set", () => {
    expect(sectionsOf(DEFAULT_SETUP)).toEqual({ llm: true, systemOne: true, gate: true });
    expect(sectionsOf(setup({ llm: "none" }))).toEqual({
      llm: false,
      systemOne: true,
      gate: false,
    });
    expect(sectionsOf(setup({ systemOne: "none" }))).toEqual({
      llm: true,
      systemOne: false,
      gate: false,
    });
  });
});

describe("resolveSide", () => {
  it("keeps a chosen colour and resolves Random through the injected source", () => {
    const never = () => {
      throw new Error("random() called for a fixed side");
    };
    expect(resolveSide("white", never)).toBe("white");
    expect(resolveSide("black", never)).toBe("black");
    expect(resolveSide("random", () => 0.2)).toBe("white");
    expect(resolveSide("random", () => 0.5)).toBe("black");
  });
});

describe("sanitizeSetup", () => {
  it("keeps valid fields and replaces each invalid one with its default", () => {
    const stored = setup({
      side: "random",
      systemOne: "none",
      llm: "custom",
      customModel: "openai:gpt-5.6-sol",
      knobs: { ...DEFAULT_SETUP.knobs, k: 7 },
    });
    expect(sanitizeSetup(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
    expect(
      sanitizeSetup({
        side: "green",
        systemOne: "stockfish",
        llm: 3,
        customModel: null,
        knobs: { k: 0, policy: "llm", human_side: "black" },
      }),
    ).toEqual(DEFAULT_SETUP);
    expect(sanitizeSetup("nope")).toEqual(DEFAULT_SETUP);
    expect(Object.keys(sanitizeSetup({}).knobs)).not.toContain("policy");
  });
});

describe("setupFromContext", () => {
  it("maps the old policy and models onto the pickers", () => {
    expect(
      setupFromContext({ policy: "hybrid", model: "langsmith:openai/gpt-6-luna" }),
    ).toMatchObject({
      side: "white",
      systemOne: "semif-qwen3.5-4b",
      llm: "langsmith:openai/gpt-6-luna",
      customModel: "",
    });
    expect(
      setupFromContext({ policy: "llm", model: "openai:gpt-5.6-sol", threshold: 0.3 }),
    ).toEqual({
      ...DEFAULT_SETUP,
      systemOne: "none",
      llm: "custom",
      customModel: "openai:gpt-5.6-sol",
      knobs: { ...DEFAULT_SETUP.knobs, threshold: 0.3 },
    });
    expect(
      setupFromContext({ policy: "systemone", systemone_model: "typesafe/jev-latest" }),
    ).toMatchObject({ systemOne: "typesafe/jev-latest", llm: "none" });
    expect(setupFromContext(undefined)).toEqual(DEFAULT_SETUP);
  });
});

describe("games", () => {
  const recorded = { ...DEFAULT_CONTEXT, policy: "llm" as const, k: 9 };
  const E4_AS_BLACK = {
    moves: ["e2e4"],
    plies: [ply({ source: "llm", turn_id: "turn-1" })],
    turns: [turn({ ply: 0 })],
  };

  it("reads the context from the thread and the human's side from its external moves", () => {
    expect(gameOf({ ...E4_E5, setup: recorded }, null)).toEqual({
      side: "white",
      context: recorded,
    });
    const black = {
      moves: ["e2e4", "e7e5"],
      plies: [E4_AS_BLACK.plies[0], ply({ ply: 1, side: "black", uci: "e7e5", san: "e5" })],
      setup: recorded,
    };
    expect(gameOf(black, null)).toEqual({ side: "black", context: recorded });
  });

  it("before the human's first move, gives them the side the opponent didn't open with", () => {
    expect(gameOf({ ...E4_AS_BLACK, setup: recorded }, null)?.side).toBe("black");
    // The opponent's first turn is open but has no move yet.
    const opening = { moves: [], plies: [], turns: [turn({ status: "pending", ply: null })] };
    expect(gameOf({ ...opening, setup: recorded }, null)?.side).toBe("black");
    const blackToMove = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    expect(gameOf({ ...opening, start_fen: blackToMove, setup: recorded }, null)?.side).toBe(
      "white",
    );
  });

  it("plays a new game with its picks until the thread records them", () => {
    const chosen = { side: "white" as const, context: recorded };
    expect(gameOf({}, chosen)).toEqual(chosen);
    expect(gameOf({ setup: DEFAULT_CONTEXT }, chosen)).toEqual({
      side: "white",
      context: DEFAULT_CONTEXT,
    });
  });

  it("knows no game for a thread without a readable setup", () => {
    expect(gameOf(E4_E5, null)).toBeNull();
    expect(gameOf({ ...E4_E5, setup: { ...recorded, k: -1 } }, null)).toBeNull();
  });

  it("splits a context into its knobs", () => {
    expect(knobsOf(DEFAULT_CONTEXT)).not.toHaveProperty("model");
    expect(knobsOf(DEFAULT_CONTEXT)).toHaveProperty("threshold", 0.9);
  });
});
