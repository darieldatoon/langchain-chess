// The new-game setup: what the human picks in the modal, and the ChessContext a game plays with.
// Pure: storage lives in storage.ts.
import { isRecord, oneOf, recordedContext, sanitizeContext } from "./settings";
import {
  DEFAULT_CONTEXT,
  SETTINGS_VERSION,
  fenOrStart,
  isSetting,
  modelKwargsProblems,
  opposite,
  sentEffort,
  sideToMove,
  type ChessContext,
  type ChessValues,
  type JSONValue,
  type Side,
} from "@langchain-chess/chess-ui";

export type SideChoice = Side | "random";

/** The System 1 models the dialog offers; any other name is kept and shown as itself. */
export const SYSTEM_ONE_PRESETS = ["semif-qwen3.5-4b", "typesafe/jev-latest"] as const;
export type SystemOnePreset = (typeof SYSTEM_ONE_PRESETS)[number];

/** Inexpensive models only; anything else is a custom spec. */
export const LLM_PRESETS = [
  "langsmith:baseten/zai-org/GLM-5.3-Flash",
  "langsmith:baseten/zai-org/GLM-5.3",
  "langsmith:baseten/deepseek-ai/DeepSeek-V4-Flash-0731",
  "langsmith:fireworks/accounts/fireworks/models/minimax-m3",
  "langsmith:openai/gpt-6-luna",
  "langsmith:anthropic/claude-haiku-4-5-20251001",
] as const;
export type LlmPreset = (typeof LLM_PRESETS)[number];
export type LlmChoice = LlmPreset | "custom" | "none";

/** The knobs the Advanced section edits; the pickers own the other three. */
export type Knobs = Omit<ChessContext, "version" | "policy" | "model" | "systemone_model">;

export interface Setup {
  side: SideChoice;
  /** System 1's model, kept while it's off, so turning it back on restores it. */
  systemOne: string;
  systemOneOff: boolean;
  llm: LlmChoice;
  /** Kept while another LLM is picked, so switching back to Custom restores it. */
  customModel: string;
  knobs: Knobs;
}

const PICKED = new Set(["version", "policy", "model", "systemone_model"]);
const KNOB_KEYS = (Object.keys(DEFAULT_CONTEXT) as (keyof ChessContext)[]).filter(
  (key): key is keyof Knobs => !PICKED.has(key),
);

export function knobsOf(context: ChessContext): Knobs {
  return Object.fromEntries(KNOB_KEYS.map((key) => [key, context[key]])) as unknown as Knobs;
}

export const DEFAULT_SETUP: Setup = {
  side: "white",
  systemOne: DEFAULT_CONTEXT.systemone_model,
  systemOneOff: false,
  llm: "langsmith:baseten/zai-org/GLM-5.3-Flash",
  customModel: "",
  knobs: knobsOf(DEFAULT_CONTEXT),
};

export const SYSTEM_ONE_NAMES: Record<SystemOnePreset, string> = {
  "semif-qwen3.5-4b": "SemIf",
  "typesafe/jev-latest": "Jev",
};

const isSystemOnePreset = oneOf(...SYSTEM_ONE_PRESETS);

export function systemOneName(model: string): string {
  return isSystemOnePreset(model) ? SYSTEM_ONE_NAMES[model] : model;
}

export const LLM_NAMES: Record<LlmPreset, string> = {
  "langsmith:baseten/zai-org/GLM-5.3-Flash": "GLM-5.3 Flash",
  "langsmith:baseten/zai-org/GLM-5.3": "GLM-5.3",
  "langsmith:baseten/deepseek-ai/DeepSeek-V4-Flash-0731": "DeepSeek V4 Flash",
  "langsmith:fireworks/accounts/fireworks/models/minimax-m3": "MiniMax M3",
  "langsmith:openai/gpt-6-luna": "GPT-6 Luna",
  "langsmith:anthropic/claude-haiku-4-5-20251001": "Claude Haiku 4.5",
};

const isPreset = oneOf(...LLM_PRESETS);

export function modelName(model: string): string {
  return isPreset(model) ? LLM_NAMES[model] : model;
}

/** A playable setup pins a context; an unplayable one says what to fix. */
export type Matchup = { ok: true; context: ChessContext } | { ok: false; reason: string };

/**
 * Only a model with a known input limit can summarize; the server is asked which ones do.
 * `unknown`: the server couldn't be asked, which says nothing about the model.
 */
export type Summarize = "checking" | "yes" | "no" | "unknown";

export function modelOf(setup: Pick<Setup, "llm" | "customModel">): string | null {
  if (setup.llm === "none") return null;
  return setup.llm === "custom" ? setup.customModel.trim() : setup.llm;
}

/** The memory a game gets: off for a model that can't summarize. */
export function memoryOf(knobs: Pick<Knobs, "memory">, summarize: Summarize): boolean {
  return summarize === "no" ? false : knobs.memory;
}

export function matchupOf(setup: Setup, summarize: Summarize): Matchup {
  const model = modelOf(setup);
  const systemOne = setup.systemOneOff ? null : setup.systemOne;
  if (model === null && systemOne === null) {
    return { ok: false, reason: "Pick a System 1, an LLM, or both." };
  }
  if (model === "") return { ok: false, reason: "Enter a model spec for the custom LLM." };
  const held = model === null ? [] : modelKwargsProblems(setup.knobs.model_kwargs, "server");
  if (held.length > 0) return { ok: false, reason: `Model arguments: ${held.join("; ")}.` };
  if (model !== null && setup.knobs.memory) {
    if (summarize === "checking") {
      return { ok: false, reason: `Checking whether ${modelName(model)} can summarize…` };
    }
    if (summarize === "unknown") {
      return { ok: false, reason: `Couldn't check whether ${modelName(model)} can summarize.` };
    }
  }
  const policy = systemOne === null ? "llm" : model === null ? "systemone" : "hybrid";
  return {
    ok: true,
    context: {
      ...setup.knobs,
      version: SETTINGS_VERSION,
      memory: memoryOf(setup.knobs, summarize),
      policy,
      // The server ignores the model a policy doesn't use, but the field is required.
      model: model ?? DEFAULT_CONTEXT.model,
      systemone_model: setup.systemOne,
    },
  };
}

/** The matchup in plain words, for the modal. */
export function matchupLine(context: ChessContext): string {
  const systemOne = systemOneName(context.systemone_model);
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

/** Whether `model_kwargs` sets the effort, so the Reasoning Effort setting doesn't apply. */
export function effortOverridden(knobs: Pick<Knobs, "model_kwargs">): boolean {
  const { reasoning, reasoning_effort: effort, extra_body: extraBody } = knobs.model_kwargs;
  return (
    (effort !== undefined && effort !== null) ||
    (isRecord(reasoning) && reasoning.effort !== undefined && reasoning.effort !== null) ||
    (isRecord(extraBody) && "reasoning" in extraBody)
  );
}

/** The opponent on the game screen, e.g. "SemIf + GLM-5.3 · medium". */
export function opponentLabel(context: ChessContext): string {
  const systemOne = systemOneName(context.systemone_model);
  const effort = sentEffort(context);
  const llm =
    effort === null ? modelName(context.model) : `${modelName(context.model)} · ${effort}`;
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

export function sectionsOf(setup: Pick<Setup, "llm" | "systemOneOff">): Sections {
  const llm = setup.llm !== "none";
  const systemOne = !setup.systemOneOff;
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
  llm: ["system_prompt", "show_fen", "show_board", "move_list", "memory", "model_kwargs"],
  systemOne: ["style", "with_eval", "with_nouls"],
  gate: ["gate", "threshold", "tournament_threshold", "k", "top_p"],
  rules: ["draw_claims", "seed"],
};

export const knobText = (value: Knobs[keyof Knobs]) => {
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
};

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
    .filter((key) => JSON.stringify(context[key]) !== JSON.stringify(DEFAULT_CONTEXT[key]))
    .map((key) =>
      key === "system_prompt"
        ? "custom system prompt"
        : `${key.replaceAll("_", " ")} ${knobText(context[key])}`,
    );
}

/** Random is resolved once, when Play is pressed; the game keeps the colour it got. */
export function resolveSide(choice: SideChoice, random: () => number): Side {
  if (choice !== "random") return choice;
  return random() < 0.5 ? "white" : "black";
}

const isSideChoice = oneOf("white", "black", "random");
const isLlmChoice = oneOf(...LLM_PRESETS, "custom", "none");

/**
 * Stored setups are untrusted: every field falls back to its default on its own. A setup stored
 * before versions named System 1 "none" when it was off, and its knobs have the older forms.
 */
export function sanitizeSetup(stored: unknown): Setup {
  const record = isRecord(stored) ? stored : {};
  const versioned = "version" in record;
  const systemOneOff = versioned ? record.systemOneOff === true : record.systemOne === "none";
  const systemOne = isSetting("systemone_model", record.systemOne)
    ? record.systemOne
    : DEFAULT_SETUP.systemOne;
  const knobs = isRecord(record.knobs) ? record.knobs : {};
  return {
    side: isSideChoice(record.side) ? record.side : DEFAULT_SETUP.side,
    systemOne: !versioned && systemOne === "none" ? DEFAULT_SETUP.systemOne : systemOne,
    systemOneOff,
    llm: isLlmChoice(record.llm) ? record.llm : DEFAULT_SETUP.llm,
    customModel: typeof record.customModel === "string" ? record.customModel : "",
    knobs: knobsOf(sanitizeContext(versioned ? { ...knobs, version: record.version } : knobs)),
  };
}

/** What storage keeps: the setup, and the settings version its knobs are in. */
export function storedSetup(setup: Setup): Record<string, unknown> {
  return { version: SETTINGS_VERSION, ...setup };
}

/** Maps a pre-modal stored context (policy, model, systemone_model) onto the pickers. */
export function setupFromContext(stored: unknown): Setup {
  const context = sanitizeContext(stored);
  const preset = isPreset(context.model) ? context.model : null;
  return {
    side: DEFAULT_SETUP.side,
    systemOne: context.systemone_model,
    systemOneOff: context.policy === "llm",
    llm: context.policy === "systemone" ? "none" : (preset ?? "custom"),
    customModel: preset === null ? context.model : "",
    knobs: knobsOf(context),
  };
}

/** A game's human side and the context every run of it sends. */
export interface GameRecord {
  side: Side;
  context: ChessContext;
}

/**
 * The human plays the external moves. Before the first, the side the opponent didn't open with;
 * before any move, the side picked, else the side not to move: the opponent's first turn is open.
 */
function humanSideOf(values: ChessValues, picked: Side | null): Side {
  const plies = values.plies ?? [];
  const external = plies.findLast((p) => p.source === "external");
  if (external) return external.side;
  if (plies[0]) return opposite(plies[0].side);
  return picked ?? opposite(sideToMove(fenOrStart(values.start_fen)));
}

/**
 * The game from its thread, falling back to a new game's picks until its first turn records
 * them. Null for a thread with no readable `setup`: a guessed context would play another game.
 */
export function gameOf(values: ChessValues, chosen: GameRecord | null): GameRecord | null {
  const context = recordedContext(values.setup) ?? chosen?.context;
  return context ? { side: humanSideOf(values, chosen?.side ?? null), context } : null;
}

export type Kwargs = { [key: string]: JSONValue };

/** The object `text` holds, else why it can't be sent. Empty text is no kwargs. */
export function parseKwargs(
  text: string,
): { ok: true; value: Kwargs } | { ok: false; why: string } {
  if (text.trim() === "") return { ok: true, value: {} };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, why: "Not valid JSON." };
  }
  if (!isRecord(value)) return { ok: false, why: "Use a JSON object." };
  if (!isSetting("model_kwargs", value)) {
    const local = modelKwargsProblems(value, "local");
    return { ok: false, why: local.length > 0 ? local.join("; ") : "Use finite numbers." };
  }
  const problems = modelKwargsProblems(value, "server");
  return problems.length > 0
    ? { ok: false, why: problems.join("; ") }
    : { ok: true, value: value as Kwargs };
}
