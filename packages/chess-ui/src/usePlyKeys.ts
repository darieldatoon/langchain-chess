import { useEffect } from "react";

const STEPS: Record<string, (index: number, last: number) => number> = {
  ArrowLeft: (i) => i - 1,
  ArrowRight: (i) => i + 1,
  Home: () => 0,
  End: (_, last) => last,
};

/**
 * Arrow keys step through the moves, Home and End jump to either end. Listens on the window, not
 * the board: the board's drag layer takes arrow keys from focused squares. Typing in a field is
 * left alone.
 */
export function usePlyKeys(index: number, last: number, onGo: (index: number) => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const step = STEPS[event.key];
      const target = event.target;
      if (
        !step ||
        (target instanceof Element && target.closest("input, textarea, [role=combobox]"))
      )
        return;
      event.preventDefault();
      onGo(Math.max(0, Math.min(last, step(index, last))));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [index, last, onGo]);
}
