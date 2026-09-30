import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import type { Space } from "./sizing";

/** Before the first measurement, and where nothing is laid out (jsdom): a desktop. */
export const UNMEASURED: Space = { width: 1280, height: 800 };

const sizeOf = (el: HTMLElement): Space | null =>
  el.clientWidth > 0 ? { width: el.clientWidth, height: el.clientHeight } : null;

/** The element's content size, kept current with a `ResizeObserver`. */
export function useContainerLayout(ref: RefObject<HTMLElement | null>): Space {
  const [space, setSpace] = useState<Space>(UNMEASURED);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const next = sizeOf(el);
      if (next) {
        setSpace((s) => (s.width === next.width && s.height === next.height ? s : next));
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return space;
}

const COARSE = "(pointer: coarse)";

/** Whether the primary pointer is a finger, so controls and strips take their touch sizes. */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() => window.matchMedia(COARSE).matches);
  useEffect(() => {
    const query = window.matchMedia(COARSE);
    const onChange = () => setCoarse(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return coarse;
}
