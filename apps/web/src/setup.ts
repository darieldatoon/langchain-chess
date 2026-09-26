// The new-game setup: what the human picks in the modal, and the ChessContext it pins to a game.
// Pure: storage lives in storage.ts.
import { isRecord, oneOf, sanitizeContext } from "./settings";
import {
  DEFAULT_CONTEXT,
  type ChessContext,
  type Memory,
  type Side,
  type SystemOneModel,
} from "@langchain-chess/chess-ui";

export type SideChoice = Side | "random";
export type SystemOneChoice = SystemOneModel | "none";

export const LLM_PRESETS = [
  "langsmith:anthropic/claude-opus-5-5",
  "langsmith:anthropic/claude-opus-5",
  "langsmith:openai/gpt-5.6-sol",
] as const;
export type LlmPreset = (typeof LLM_PRESETS)[number];
export type LlmChoice = LlmPreset | "custom" | "none";

/** The knobs the Advanced section edits; the pickers own the other three. */
export type Knobs = Omit<ChessContext, "policy" | "model" | "systemone_model">;

export interface Setup {
  side: SideChoice;
  systemOne: SystemOneChoice;
  llm: LlmChoice;
  /** Kept while another LLM is picked, so switching back to Custom restores it. */
  customModel: string;
  knobs: Knobs;
}

const KNOB_KEYS = (Object.keys(DEFAULT_CONTEXT) as (keyof ChessContext)[]).filter(
  (key): key is keyof Knobs => key !== "policy" && key !== "model" && key !== "systemone_model",
);

export function knobsOf(context: ChessContext): Knobs {
  return Object.fromEntries(KNOB_KEYS.map((key) => [key, context[key]])) as unknown as Knobs;
}

export const DEFAULT_SETUP: Setup = {
  side: "white",
  systemOne: DEFAULT_CONTEXT.systemone_model,
  llm: "langsmith:anthropic/claude-opus-5-5",
  customModel: "",
  knobs: knobsOf(DEFAULT_CONTEXT),
};

export const SYSTEM_ONE_NAMES: Record<SystemOneModel, string> = {
  "semif-qwen3.5-4b": "SemIf",
  "typesafe/jev-latest": "Jev",
};

export const LLM_NAMES: Record<LlmPreset, string> = {
  "langsmith:anthropic/claude-opus-5-5": "Claude Opus 5.5",
  "langsmith:anthropic/claude-opus-5": "Claude Opus 5",
  "langsmith:openai/gpt-5.6-sol": "GPT-5.6 Sol",
};

const isPreset = oneOf(...LLM_PRESETS);

export function modelName(model: string): string {
  return isPreset(model) ? LLM_NAMES[model] : model;
}

/** A playable setup pins a context; an unplayable one says what to fix. */
export type Matchup = { ok: true; context: ChessContext } | { ok: false; reason: string };

/** Only a model with a known input limit can summarize; the server is asked which ones do. */
export type Summarize = "checking" | "yes" | "no";

export function modelOf(setup: Pick<Setup, "llm" | "customModel">): string | null {
  if (setup.llm === "none") return null;
  return setup.llm === "custom" ? setup.customModel.trim() : setup.llm;
}

/** The memory a game gets: `summarize` falls back to `none` for a model that can't summarize. */
export function memoryOf(knobs: Pick<Knobs, "memory">, summarize: Summarize): Memory {
  return summarize === "no" ? "none" : knobs.memory;
}

export function matchupOf(setup: Setup, summarize: Summarize): Matchup {
  const model = modelOf(setup);
  const systemOne = setup.systemOne === "none" ? null : setup.systemOne;
  if (model === null && systemOne === null) {
    return { ok: false, reason: "Pick a System 1, an LLM, or both." };
  }
  if (model === "") return { ok: false, reason: "Enter a model spec for the custom LLM." };
  if (model !== null && setup.knobs.memory === "summarize" && summarize === "checking") {
    return { ok: false, reason: `Checking whether ${modelName(model)} can summarize…` };
  }
  const policy = systemOne === null ? "llm" : model === null ? "systemone" : "hybrid";
  return {
    ok: true,
    context: {
      ...setup.knobs,
      memory: memoryOf(setup.knobs, summarize),
      policy,
      // The server ignores the model a policy doesn't use, but the field is required.
      model: model ?? DEFAULT_CONTEXT.model,
      systemone_model: systemOne ?? DEFAULT_CONTEXT.systemone_model,
    },
  };
}

/** The matchup in plain words, for the modal. */
export function matchupLine(context: ChessContext): string {
  const systemOne = SYSTEM_ONE_NAMES[context.systemone_model];
  const llm = modelName(context.model);
  switch (context.policy) {
    case "hybrid":
      return `${systemOne} plays confident moves; ${llm} decides the rest.`;
    case "systemone":
      return `${systemOne} plays every move.`;
    case "llm":
      return `${llm} plays every move.`;
  }
}

/** The opponent on the game screen, e.g. "SemIf + Claude Opus 5.5 · medium". */
export function opponentLabel(context: ChessContext): string {
  const systemOne = SYSTEM_ONE_NAMES[context.systemone_model];
  const llm = `${modelName(context.model)} · ${context.reasoning_effort}`;
  switch (context.policy) {
    case "hybrid":
      return `${systemOne} + ${llm}`;
    case "systemone":
      return systemOne;
    case "llm":
      return llm;
  }
}

export interface Sections {
  llm: boolean;
  systemOne: boolean;
  /** Gate and shortlist knobs only matter when System 1 hands moves to an LLM. */
  gate: boolean;
}

export function sectionsOf(setup: Pick<Setup, "llm" | "systemOne">): Sections {
  const llm = setup.llm !== "none";
  const systemOne = setup.systemOne !== "none";
  return { llm, systemOne, gate: llm && systemOne };
}

function sectionsOfPolicy(policy: ChessContext["policy"]): Sections {
  return {
    llm: policy !== "systemone",
    systemOne: policy !== "llm",
    gate: policy === "hybrid",
  };
}

const KNOB_SECTIONS: Record<keyof Sections | "rules", readonly (keyof Knobs)[]> = {
  llm: ["show_legal_moves", "memory"],
  systemOne: ["style", "with_eval", "with_nouls"],
  gate: ["gate", "threshold", "tournament_threshold", "k", "top_p"],
  rules: ["draw_claims", "seed"],
};

const knobText = (value: Knobs[keyof Knobs]) =>
  typeof value === "boolean" ? (value ? "on" : "off") : String(value);

/** Knobs the game's policy uses that differ from the defaults, e.g. ["threshold 0.5", "k 3"]. */
export function changedKnobs(context: ChessContext): string[] {
  const sections = sectionsOfPolicy(context.policy);
  const keys = [
    ...(sections.llm ? KNOB_SECTIONS.llm : []),
    ...(sections.systemOne ? KNOB_SECTIONS.systemOne : []),
    ...(sections.gate ? KNOB_SECTIONS.gate : []),
    ...KNOB_SECTIONS.rules,
  ];
  return keys
    .filter((key) => context[key] !== DEFAULT_CONTEXT[key])
    .map((key) => `${key.replaceAll("_", " ")} ${knobText(context[key])}`);
}

/** Random is resolved once, when Play is pressed; the game keeps the colour it got. */
export function resolveSide(choice: SideChoice, random: () => number): Side {
  if (choice !== "random") return choice;
  return random() < 0.5 ? "white" : "black";
}

const isSideChoice = oneOf("white", "black", "random");
const isSystemOneChoice = oneOf("semif-qwen3.5-4b", "typesafe/jev-latest", "none");
const isLlmChoice = oneOf(...LLM_PRESETS, "custom", "none");

/** Stored setups are untrusted: every field falls back to its default on its own. */
export function sanitizeSetup(stored: unknown): Setup {
  const record = isRecord(stored) ? stored : {};
  return {
    side: isSideChoice(record.side) ? record.side : DEFAULT_SETUP.side,
    systemOne: isSystemOneChoice(record.systemOne) ? record.systemOne : DEFAULT_SETUP.systemOne,
    llm: isLlmChoice(record.llm) ? record.llm : DEFAULT_SETUP.llm,
    customModel: typeof record.customModel === "string" ? record.customModel : "",
    knobs: knobsOf(sanitizeContext(record.knobs)),
  };
}

/** Maps a pre-modal stored context (policy, model, systemone_model) onto the pickers. */
export function setupFromContext(stored: unknown): Setup {
  const context = sanitizeContext(stored);
  const preset = isPreset(context.model) ? context.model : null;
  return {
    side: DEFAULT_SETUP.side,
    systemOne: context.policy === "llm" ? "none" : context.systemone_model,
    llm: context.policy === "systemone" ? "none" : (preset ?? "custom"),
    customModel: preset === null ? context.model : "",
    knobs: knobsOf(context),
  };
}

export const isSide = oneOf("white", "black");

/** A game's pinned side and context; both are adapter state, not graph state. */
export interface GameRecord {
  side: Side;
  context: ChessContext;
}

export function sanitizeGame(stored: unknown): GameRecord {
  const record = isRecord(stored) ? stored : {};
  return {
    side: isSide(record.side) ? record.side : "white",
    context: sanitizeContext(record.context),
  };
}
