import { othersKey, STEP_KEYS } from "@langchain-chess/chess-ui";
import { useEffect } from "react";

interface PreviewKeys {
  /** Null while nothing is pinned: the game keys have the window then. */
  at: number | null;
  last: number;
  onStep: (at: number) => void;
  onLeave: () => void;
}

/** A pinned preview's keys: the game's steps move within the line, Esc leaves it. */
export function usePreviewKeys({ at, last, onStep, onLeave }: PreviewKeys): void {
  useEffect(() => {
    if (at === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (othersKey(event)) return;
      const step = STEP_KEYS[event.key];
      if (step) {
        event.preventDefault();
        onStep(Math.max(0, Math.min(last, step(at, last))));
      } else if (event.key === "Escape") {
        onLeave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [at, last, onStep, onLeave]);
}
