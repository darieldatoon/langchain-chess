import { describe, expect, it } from "vite-plus/test";
import {
  changedKnobs,
  DEFAULT_SETUP,
  effortOf,
  effortOverridden,
  gameOf,
  importedSetup,
  knobText,
  LLM_PRESETS,
  knobsOf,
  matchupLine,
  matchupOf,
  modelName,
  opponentLabel,
  parseKwargs,
  resolveSide,
  sanitizeSetup,
  sectionsOf,
  storedSetup,
  systemOneName,
  type Setup,
} from "../src/setup";
import { DEFAULT_CONTEXT, type ChessContext } from "@langchain-chess/chess-ui";
import efforts from "../../../libs/chess/langchain_chess/efforts.json";
import { E4_E5, ply, turn } from "@langchain-chess/chess-ui/testing";

const setup = (overrides: Partial<Setup> = {}): Setup => ({ ...DEFAULT_SETUP, ...overrides });

function contextOf(s: Setup): ChessContext {
  const matchup = matchupOf(s, "yes", true);
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
      contextOf(setup({ systemOneOff: true, llm: "langsmith:baseten/zai-org/GLM-5.3" })),
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

  it("keeps System 1's model while it's off, and any model name", () => {
    expect(contextOf(setup({ systemOne: "someone/ranker", systemOneOff: true }))).toMatchObject({
      policy: "llm",
      systemone_model: "someone/ranker",
    });
    expect(contextOf(setup({ systemOne: "none" }))).toMatchObject({
      policy: "hybrid",
      systemone_model: "none",
    });
  });

  it("holds a game whose model kwargs the server won't send", () => {
    const knobs = { ...DEFAULT_SETUP.knobs, model_kwargs: { seed: 3 } };
    expect(matchupOf(setup({ knobs }), "yes", true)).toEqual({
      ok: false,
      reason: "Model arguments: `seed`: the server doesn't send it.",
    });
    expect(matchupOf(setup({ knobs, llm: "none" }), "yes", true)).toMatchObject({ ok: true });
  });

  it("refuses both None and an empty custom model", () => {
    expect(matchupOf(setup({ systemOneOff: true, llm: "none" }), "yes", true)).toEqual({
      ok: false,
      reason: "Pick a System 1, an LLM, or both.",
    });
    expect(matchupOf(setup({ llm: "custom", customModel: "  " }), "yes", true)).toEqual({
      ok: false,
      reason: "Enter a model spec for the custom LLM.",
    });
  });

  it("summarizes only with a model that can, and waits for the answer", () => {
    const summarizing = setup({ knobs: { ...DEFAULT_SETUP.knobs, memory: true } });
    expect(matchupOf(summarizing, "yes", true)).toMatchObject({ context: { memory: true } });
    expect(matchupOf(summarizing, "no", true)).toMatchObject({ context: { memory: false } });
    expect(matchupOf(summarizing, "checking", true)).toEqual({
      ok: false,
      reason: "Checking whether GLM-5.3 Flash can summarize…",
    });
    expect(matchupOf(summarizing, "unknown", true)).toEqual({
      ok: false,
      reason: "Couldn't check whether GLM-5.3 Flash can summarize.",
    });
    expect(matchupOf(setup(), "checking", true)).toMatchObject({ ok: true });
    expect(matchupOf(setup(), "unknown", true)).toMatchObject({ ok: true });
    const alone = { ...summarizing, llm: "none" as const };
    expect(matchupOf(alone, "checking", true)).toMatchObject({ ok: true });
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
    expect(opponentLabel({ ...DEFAULT_CONTEXT, systemone_model: "someone/ranker" })).toBe(
      "someone/ranker + GLM-5.3 Flash",
    );
    expect(systemOneName("typesafe/jev-latest")).toBe("Jev");
    const kwargs = { reasoning_effort: "high" };
    expect(opponentLabel({ ...DEFAULT_CONTEXT, policy: "llm", model_kwargs: kwargs })).toBe(
      "GLM-5.3 Flash · high",
    );
  });

  it("plays no effort for a model that takes none", () => {
    const knobs = { ...DEFAULT_SETUP.knobs, reasoning_effort: "high" as const };
    expect(effortOf(knobs, false)).toBeNull();
    expect(effortOf(knobs, true)).toBe("high");
    expect(effortOf(knobs, "checking")).toBe("high");
    expect(matchupOf(setup({ knobs }), "yes", false)).toMatchObject({
      context: { reasoning_effort: null },
    });
    expect(matchupOf(setup({ knobs }), "yes", true)).toMatchObject({
      context: { reasoning_effort: "high" },
    });
    expect(matchupOf(setup({ knobs }), "yes", "checking")).toEqual({
      ok: false,
      reason: "Checking whether GLM-5.3 Flash takes a reasoning effort…",
    });
    // No effort is sent: nothing to check.
    expect(matchupOf(setup(), "yes", "checking")).toMatchObject({ ok: true });
    expect(matchupOf(setup({ knobs, llm: "none" }), "yes", false)).toMatchObject({ ok: true });
  });

  it("knows when model kwargs set the effort", () => {
    const of = (model_kwargs: Record<string, never> | object) =>
      effortOverridden({ model_kwargs: model_kwargs as never });
    expect(of({})).toBe(false);
    expect(of({ reasoning_effort: null, reasoning: { summary: "auto" } })).toBe(false);
    expect(of({ reasoning_effort: "low" })).toBe(true);
    expect(of({ reasoning: { effort: "low" } })).toBe(true);
    expect(of({ extra_body: { reasoning: {} } })).toBe(true);
  });

  it("parses model kwargs text", () => {
    expect(parseKwargs("  ")).toEqual({ ok: true, value: {} });
    expect(parseKwargs('{"temperature": 0.2}')).toEqual({ ok: true, value: { temperature: 0.2 } });
    expect(parseKwargs("{")).toEqual({ ok: false, why: "Not valid JSON." });
    expect(parseKwargs("[1]")).toEqual({ ok: false, why: "Use a JSON object." });
    expect(parseKwargs('{"temperature": 1e999}')).toEqual({
      ok: false,
      why: "Use finite numbers.",
    });
    expect(parseKwargs('{"name": "x"}')).toEqual({ ok: false, why: "`name`: the app sets it" });
    expect(parseKwargs('{"seed": 1}')).toEqual({
      ok: false,
      why: "`seed`: the server doesn't send it",
    });
    expect(parseKwargs('{"base_url": "x"}')).toEqual({
      ok: false,
      why: "`base_url`: credentials and connections come from the environment",
    });
  });

  it("words a knob's value", () => {
    expect([knobText(true), knobText(false), knobText(0.5), knobText(null)]).toEqual([
      "on",
      "off",
      "0.5",
      "null",
    ]);
  });

  it("lists only the changed knobs the policy uses", () => {
    expect(changedKnobs(DEFAULT_CONTEXT)).toEqual([]);
    const tuned: ChessContext = {
      ...DEFAULT_CONTEXT,
      threshold: 0.5,
      move_list: "none",
      memory: true,
      with_eval: true,
      draw_claims: "never",
      reasoning_effort: "high",
    };
    expect(
      changedKnobs({ ...tuned, system_prompt: "Be bold.", model_kwargs: { temperature: 0 } }),
    ).toContain("custom system prompt");
    expect(changedKnobs({ ...tuned, model_kwargs: { temperature: 0 } })).toContain(
      'model kwargs {"temperature":0}',
    );
    expect(changedKnobs(tuned)).toEqual([
      "move list none",
      "memory on",
      "with eval on",
      "threshold 0.5",
      "draw claims never",
    ]);
    expect(changedKnobs({ ...tuned, policy: "systemone" })).toEqual([
      "with eval on",
      "draw claims never",
    ]);
    expect(changedKnobs({ ...tuned, policy: "llm" })).toEqual([
      "move list none",
      "memory on",
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
    expect(sectionsOf(setup({ systemOneOff: true }))).toEqual({
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
      systemOne: "someone/ranker",
      systemOneOff: true,
      llm: "custom",
      customModel: "openai:gpt-5.6-sol",
      knobs: { ...DEFAULT_SETUP.knobs, k: 7, move_list: "legal", memory: true },
    });
    expect(sanitizeSetup(JSON.parse(JSON.stringify(storedSetup(stored))))).toEqual(stored);
    expect(
      sanitizeSetup({
        version: 1,
        side: "green",
        systemOne: "",
        systemOneOff: "yes",
        llm: 3,
        customModel: null,
        knobs: { k: 0, policy: "llm", human_side: "black", memory: "summarize" },
      }),
    ).toEqual(DEFAULT_SETUP);
    expect(sanitizeSetup({ version: 99, knobs: { k: 7 } })).toEqual(DEFAULT_SETUP);
    expect(sanitizeSetup("nope")).toEqual(DEFAULT_SETUP);
    expect(Object.keys(sanitizeSetup({}).knobs)).not.toContain("policy");
  });

  it("resets a setup without a version to the defaults", () => {
    const unversioned = { side: "black", systemOne: "typesafe/jev-latest", knobs: { k: 3 } };
    expect(sanitizeSetup(unversioned)).toEqual(DEFAULT_SETUP);
  });
});

describe("importedSetup", () => {
  it("plays a settings file with the side picked", () => {
    const file = { version: 2, policy: "llm", model: "openai:gpt-6-luna", k: 3 };
    expect(importedSetup(file, "black")).toEqual({
      ok: true,
      setup: {
        ...DEFAULT_SETUP,
        side: "black",
        systemOneOff: true,
        llm: "custom",
        customModel: "openai:gpt-6-luna",
        knobs: { ...DEFAULT_SETUP.knobs, k: 3 },
      },
    });
    expect(importedSetup({ version: 2, policy: "systemone" }, "white")).toEqual({
      ok: true,
      setup: { ...DEFAULT_SETUP, llm: "none" },
    });
    expect(importedSetup({ k: 3 }, "white")).toEqual({
      ok: false,
      why: "settings need a `version`",
    });
    expect(importedSetup({ version: 2, k: 0 }, "white")).toEqual({
      ok: false,
      why: "invalid settings: k",
    });
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
    const { version: _, ...unversioned } = recorded;
    expect(gameOf({ ...E4_E5, setup: unversioned }, null)).toBeNull();
  });

  it("splits a context into its knobs", () => {
    expect(knobsOf(DEFAULT_CONTEXT)).not.toHaveProperty("model");
    expect(knobsOf(DEFAULT_CONTEXT)).toHaveProperty("threshold", 0.9);
  });
});

describe("LLM_PRESETS", () => {
  // The server knows a model takes no effort only once `mise run probe:efforts` asked it.
  it("has each preset's reasoning effort probed", () => {
    expect(LLM_PRESETS.filter((model) => !(model in efforts))).toEqual([]);
  });
});
