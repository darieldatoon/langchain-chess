import { useEffect, useRef, useState } from "react";

export const APP_TITLE = "LangChain Chess";

export interface TitleInput {
  /** It became the reader's move while the tab was hidden. */
  yourTurn: boolean;
  over: boolean;
}

/** The tab's title. Pure. */
export function pageTitle({ yourTurn, over }: TitleInput): string {
  // An alert raised before the game ended must not outlive it.
  if (over) return `Game over · ${APP_TITLE}`;
  return yourTurn ? `Your turn · ${APP_TITLE}` : APP_TITLE;
}

/**
 * True from the moment it becomes the reader's move while the tab is hidden until the tab is
 * shown again. The first settled value is only a baseline: loading a thread whose move is yours
 * is not your move arriving.
 */
export function useTurnAlert(turn: boolean, settled: boolean, doc: Document = document): boolean {
  const [alert, setAlert] = useState(false);
  const was = useRef<boolean | null>(null);
  useEffect(() => {
    // Loading or browsing: the next settled value is a fresh baseline, not a move arriving.
    if (!settled) {
      was.current = null;
      return;
    }
    const became = was.current === false && turn;
    was.current = turn;
    if (became && doc.hidden) setAlert(true);
  }, [turn, settled, doc]);
  useEffect(() => {
    const onVisible = () => {
      if (!doc.hidden) setAlert(false);
    };
    doc.addEventListener("visibilitychange", onVisible);
    return () => doc.removeEventListener("visibilitychange", onVisible);
  }, [doc]);
  return alert;
}

/** Keeps `document.title` on `title`, and puts the app's back on unmount. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
  useEffect(
    () => () => {
      document.title = APP_TITLE;
    },
    [],
  );
}
