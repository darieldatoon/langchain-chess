import { useEffect, useRef, useState } from "react";
import type { Side } from "@langchain-chess/chess-ui";
import { remaining, type Clock } from "./clock";

/** A monotonic time in ms; injectable so tests control it. */
export type Now = () => number;
export const monotonic: Now = () => performance.now();

/** Tenths are the finest a clock shows. */
export const TICK_MS = 100;

/**
 * The time, re-read every tick while `active`: enough to redraw a running clock. Stale for the
 * first tick after it starts, which `remaining` reads as the clock's start.
 */
export function useNow(active: boolean, now: Now): number {
  const [time, setTime] = useState(now);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTime(now()), TICK_MS);
    return () => clearInterval(timer);
  }, [active, now]);
  return time;
}

/** Calls `onFlag` once the running clock reaches zero. */
export function useFlag(clock: Clock | null, now: Now, onFlag: (side: Side) => void): void {
  // The latest callback, so a re-render doesn't reschedule the timer.
  const flag = useRef(onFlag);
  useEffect(() => {
    flag.current = onFlag;
  });
  const side = clock?.running?.side;
  useEffect(() => {
    if (!clock || !side) return;
    const timer = setTimeout(() => flag.current(side), remaining(clock, side, now()));
    return () => clearTimeout(timer);
  }, [clock, side, now]);
}
