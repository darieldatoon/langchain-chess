import { useEffect } from "react";

const STEPS: Record<string, (index: number, last: number) => number> = {
  ArrowLeft: (i) => i - 1,
  k: (i) => i - 1,
  ArrowRight: (i) => i + 1,
  j: (i) => i + 1,
  Home: () => 0,
  ArrowUp: () => 0,
  End: (_, last) => last,
  ArrowDown: (_, last) => last,
};

/** Keys typed here belong to the control, not the game: fields, dialogs, menus, popovers. */
const OWN_KEYS =
  "input, textarea, select, [contenteditable], [role=combobox], [role=dialog], [role=menu], [role=listbox], [data-radix-popper-content-wrapper]";

export interface GameKeys {
  index: number;
  last: number;
  onGo: (index: number) => void;
  onFlip: () => void;
  onHelp: () => void;
  /** False while something else owns the keys, such as a pinned preview. */
  enabled?: boolean;
}

/**
 * ←/→ or k/j step, Home/End or ↑/↓ jump to either end, `f` flips, `?` lists the keys. Listens on
 * the window, not the board: the board's drag layer takes arrow keys from focused squares.
 */
export function useGameKeys({ index, last, onGo, onFlip, onHelp, enabled = true }: GameKeys): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      // A control that handled the key (a menu trigger opening on ArrowDown) keeps it.
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (target instanceof Element && target.closest(OWN_KEYS)) return;
      const step = STEPS[event.key];
      if (step) {
        event.preventDefault();
        onGo(Math.max(0, Math.min(last, step(index, last))));
      } else if (event.key === "f") {
        onFlip();
      } else if (event.key === "?") {
        onHelp();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [index, last, onGo, onFlip, onHelp, enabled]);
}
