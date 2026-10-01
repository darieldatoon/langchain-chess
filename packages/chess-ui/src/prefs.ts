// How the board is shown and driven: one record both apps keep, the web app in localStorage
// and the review app for the session. Pure.
import { DEFAULT_TURN_VIEW, type TurnView } from "./types";

export type Animation = "off" | "fast" | "normal";
export type MoveInput = "both" | "click" | "drag";

export interface DisplayPrefs {
  showMaterial: boolean;
  showLegalMoves: boolean;
  coordinates: boolean;
  animation: Animation;
  /** The board's share of the room it could take, on `full` and `wide`. */
  boardScale: number;
  wheelSteps: boolean;
  /** Review only: the "Blunder. Qd8 was best." rows under graded moves. */
  mistakeNotes: boolean;
  moveInput: MoveInput;
  autoQueen: boolean;
  /** Web only: "Your turn" in the tab title while the tab is hidden. */
  tabTitle: boolean;
}

export const DEFAULT_DISPLAY_PREFS: DisplayPrefs = {
  showMaterial: true,
  showLegalMoves: true,
  coordinates: true,
  animation: "normal",
  boardScale: 1,
  wheelSteps: false,
  mistakeNotes: true,
  moveInput: "both",
  autoQueen: false,
  tabTitle: true,
};

export const BOARD_SCALE = { min: 0.6, max: 1, step: 0.05 } as const;

export const ANIMATION_MS: Record<Animation, number> = { off: 0, fast: 120, normal: 200 };

const ANIMATIONS: readonly unknown[] = ["off", "fast", "normal"];
const MOVE_INPUTS: readonly unknown[] = ["both", "click", "drag"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Stored preferences are untrusted: each field falls back to its default on its own. */
export function sanitizeDisplayPrefs(stored: unknown): DisplayPrefs {
  const record = isRecord(stored) ? stored : {};
  const d = DEFAULT_DISPLAY_PREFS;
  const flag = (key: keyof DisplayPrefs): boolean => {
    const value = record[key];
    return typeof value === "boolean" ? value : (d[key] as boolean);
  };
  const scale = record.boardScale;
  return {
    showMaterial: flag("showMaterial"),
    showLegalMoves: flag("showLegalMoves"),
    coordinates: flag("coordinates"),
    animation: ANIMATIONS.includes(record.animation)
      ? (record.animation as Animation)
      : d.animation,
    boardScale:
      typeof scale === "number" && scale >= BOARD_SCALE.min && scale <= BOARD_SCALE.max
        ? scale
        : d.boardScale,
    wheelSteps: flag("wheelSteps"),
    mistakeNotes: flag("mistakeNotes"),
    moveInput: MOVE_INPUTS.includes(record.moveInput)
      ? (record.moveInput as MoveInput)
      : d.moveInput,
    autoQueen: flag("autoQueen"),
    tabTitle: flag("tabTitle"),
  };
}

/**
 * A stored reply-card view, field by field over the defaults. Migrates the older `PlyView`
 * (`{ reasoning, topMoves }`), stored under the same key.
 */
export function sanitizeTurnView(stored: unknown): TurnView {
  const record = isRecord(stored) ? stored : {};
  const open = isRecord(record.open) ? record.open : {};
  const show = isRecord(record.show) ? record.show : {};
  const d = DEFAULT_TURN_VIEW;
  const flag = (value: unknown, fallback: boolean) =>
    typeof value === "boolean" ? value : fallback;
  return {
    open: { systemOne: flag(open.systemOne, d.open.systemOne), llm: flag(open.llm, d.open.llm) },
    show: {
      topMoves: flag(show.topMoves, flag(record.topMoves, d.show.topMoves)),
      gate: flag(show.gate, d.show.gate),
      analysis: flag(show.analysis, flag(record.reasoning, d.show.analysis)),
      stageStats: flag(show.stageStats, d.show.stageStats),
      gameSoFar: flag(show.gameSoFar, d.show.gameSoFar),
      tokens: flag(show.tokens, d.show.tokens),
    },
  };
}
