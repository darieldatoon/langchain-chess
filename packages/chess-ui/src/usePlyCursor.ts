import { useCallback, useState } from "react";
import { usePlyKeys } from "./usePlyKeys";

export interface PlyCursor {
  /** The position shown: 0 is the start, `last` the latest. */
  index: number;
  /** Whether it follows the game's latest position. */
  live: boolean;
  go: (index: number) => void;
}

/**
 * The position a game is shown at, stepped by the controls and the arrow keys. At the end it
 * follows the game, so a move arriving moves it along; an earlier position stays put until Last
 * or End comes back.
 */
export function usePlyCursor(last: number): PlyCursor {
  const [viewed, setViewed] = useState<number | null>(null);
  const live = viewed === null || viewed >= last;
  const index = live ? last : viewed;
  const go = useCallback(
    (next: number) => setViewed(next >= last ? null : Math.max(0, next)),
    [last],
  );
  usePlyKeys(index, last, go);
  return { index, live, go };
}
