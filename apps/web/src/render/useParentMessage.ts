import { useEffect, useState } from "react";
import { readMessage, type Shown } from "./messages";

export function isEmbedded(): boolean {
  return window.parent !== window;
}

/** The latest renderer message from the embedding window; null until one arrives. */
export function useParentMessage(): Shown | null {
  const [shown, setShown] = useState<Shown | null>(null);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Trust the embedding window, not an origin: self-hosted LangSmith can live anywhere.
      // Do not drop the `isEmbedded` check: a top-level page is its own parent.
      if (!isEmbedded() || event.source !== window.parent) return;
      const next = readMessage(event.data);
      if (next) setShown(next);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return shown;
}
