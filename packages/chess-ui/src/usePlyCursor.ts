import { useCallback, useState } from "react";

export interface PlyCursor {
  /** The position shown: 0 is the start, `last` the latest. */
  index: number;
  /** Whether it follows the game's latest position. */
  live: boolean;
  go: (index: number) => void;
}

/**
 * The position a game is shown at. At the end it follows the game, so a move arriving moves it
 * along; an earlier position stays put until Last or End comes back.
 */
export function usePlyCursor(last: number): PlyCursor {
  const [viewed, setViewed] = useState<number | null>(null);
  const live = viewed === null || viewed >= last;
  const index = live ? last : viewed;
  const go = useCallback(
    (next: number) => setViewed(next >= last ? null : Math.max(0, next)),
    [last],
  );
  return { index, live, go };
}
