import { describe, expect, it } from "vite-plus/test";
import {
  changedKnobs,
  DEFAULT_SETUP,
  knobsOf,
  matchupLine,
  matchupOf,
  modelName,
  opponentLabel,
  resolveSide,
  sanitizeGame,
  sanitizeSetup,
  sectionsOf,
  setupFromContext,
  type Setup,
} from "../src/setup";
import { DEFAULT_CONTEXT, type ChessContext } from "@langchain-chess/chess-ui";

const setup = (overrides: Partial<Setup> = {}): Setup => ({ ...DEFAULT_SETUP, ...overrides });

function contextOf(s: Setup): ChessContext {
  const matchup = matchupOf(s);
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
      contextOf(setup({ systemOne: "none", llm: "langsmith:openai/gpt-5.6-sol" })),
    ).toMatchObject({
      policy: "llm",
      model: "langsmith:openai/gpt-5.6-sol",
    });
    expect(contextOf(setup({ systemOne: "typesafe/jev-latest" }))).toMatchObject({
      policy: "hybrid",
      systemone_model: "typesafe/jev-latest",
      model: "langsmith:anthropic/claude-opus-5-5",
    });
  });

  it("refuses both None and an empty custom model", () => {
    expect(matchupOf(setup({ systemOne: "none", llm: "none" }))).toEqual({
      ok: false,
      reason: "Pick a System 1, an LLM, or both.",
    });
    expect(matchupOf(setup({ llm: "custom", customModel: "  " }))).toEqual({
      ok: false,
      reason: "Enter a model spec for the custom LLM.",
    });
  });

  it("sends a custom model trimmed, and carries the knobs", () => {
    const knobs = { ...DEFAULT_SETUP.knobs, threshold: 0.4, k: 3 };
    const context = contextOf(
      setup({ llm: "custom", customModel: " langsmith:anthropic/claude-opus-5-5 ", knobs }),
    );
    expect(context).toEqual({
      ...DEFAULT_CONTEXT,
      model: "langsmith:anthropic/claude-opus-5-5",
      threshold: 0.4,
      k: 3,
    });
  });
});

describe("matchup wording", () => {
  it("describes the matchup in plain words", () => {
    expect(matchupLine(DEFAULT_CONTEXT)).toBe(
      "SemIf plays confident moves; Claude Opus 5.5 decides the rest.",
    );
    expect(matchupLine({ ...DEFAULT_CONTEXT, policy: "systemone" })).toBe(
      "SemIf plays every move.",
    );
    expect(matchupLine({ ...DEFAULT_CONTEXT, policy: "llm", model: "openai:gpt-5.6-sol" })).toBe(
      "openai:gpt-5.6-sol plays every move.",
    );
  });

  it("labels the opponent with the effort only when an LLM plays", () => {
    expect(opponentLabel(DEFAULT_CONTEXT)).toBe("SemIf + Claude Opus 5.5 · medium");
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
        model: "langsmith:anthropic/claude-opus-5",
        reasoning_effort: "high",
      }),
    ).toBe("Claude Opus 5 · high");
    expect(modelName("langsmith:openai/gpt-5.6-sol")).toBe("GPT-5.6 Sol");
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
      setupFromContext({ policy: "hybrid", model: "langsmith:anthropic/claude-opus-5" }),
    ).toMatchObject({
      side: "white",
      systemOne: "semif-qwen3.5-4b",
      llm: "langsmith:anthropic/claude-opus-5",
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
  it("sanitizes a stored game record", () => {
    const context = { ...DEFAULT_CONTEXT, policy: "llm" as const, k: 9 };
    expect(sanitizeGame({ side: "black", context })).toEqual({ side: "black", context });
    expect(sanitizeGame({ side: "random", context: { k: -1 } })).toEqual({
      side: "white",
      context: DEFAULT_CONTEXT,
    });
    expect(sanitizeGame(null)).toEqual({ side: "white", context: DEFAULT_CONTEXT });
  });

  it("splits a context into its knobs", () => {
    expect(knobsOf(DEFAULT_CONTEXT)).not.toHaveProperty("model");
    expect(knobsOf(DEFAULT_CONTEXT)).toHaveProperty("threshold", 0.9);
  });
});
