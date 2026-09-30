import type { SourceClass } from "./format";
import type { Quality } from "./types";

// Who played the move is what this app adds to a move list, so it keeps its colours.
export const SOURCE_CLASSES: Record<SourceClass, string> = {
  external: "",
  systemone: "bg-brand-subtle text-brand-primary",
  llm: "bg-purple text-purple",
  forced: "bg-surface-level-3 text-secondary",
  other: "bg-warning-subtle text-warning-secondary",
};

export const QUALITY_CLASSES: Record<Quality, string> = {
  best: "",
  good: "",
  inaccuracy: "text-warning-secondary",
  mistake: "text-warning-primary",
  blunder: "text-error-primary",
};

/** The move the board shows. */
export const ACTIVE_MOVE = "bg-brand text-brand-on-fill font-bold hover:bg-brand-hover";
