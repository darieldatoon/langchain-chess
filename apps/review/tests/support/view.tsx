import { fireEvent, render, renderHook } from "@testing-library/react";
import {
  DEFAULT_DISPLAY_PREFS,
  DEFAULT_TURN_VIEW,
  type DisplayPrefs,
  type OpeningTable,
  type TurnView,
} from "@langchain-chess/chess-ui";
import { useChartColorResolver } from "@langchain/macaw-components/utils/chartColors";
import { vi } from "vite-plus/test";
import type { OpenUrl } from "../../src/App";
import type { Analysis, LaunchState } from "../../src/analysis";
import { HostTheme } from "../../src/HostTheme";
import type { ReviewTab } from "../../src/tools";
import { game } from "./fixtures";
import { StatefulView, type ViewProps } from "./StatefulView";

/** What the board's colour resolver gives for a colour in the light theme. */
export function resolved(colour: string): string {
  const { result } = renderHook(() => useChartColorResolver(), {
    wrapper: ({ children }) => <HostTheme mode="light">{children}</HostTheme>,
  });
  return result.current(colour);
}

export interface ViewExtras {
  openings?: OpeningTable | null;
  openUrl?: OpenUrl;
  prefs?: DisplayPrefs;
  onPrefsChange?: (prefs: DisplayPrefs) => void;
  analysis?: Analysis | null;
  launch?: LaunchState;
  onAnalyze?: () => void;
  view?: TurnView;
  tab?: ReviewTab;
}

export const viewProps = (
  g = game(),
  onOpenTrace = vi.fn(),
  extras: ViewExtras = {},
): ViewProps => ({
  projectName: "langchain-chess-app",
  game: g,
  values: g.values!,
  view: extras.view ?? DEFAULT_TURN_VIEW,
  onViewChange: () => {},
  onOpenTrace,
  analysis: extras.analysis ?? null,
  launch: extras.launch,
  onAnalyze: extras.onAnalyze ?? (() => {}),
  layout: "wide",
  space: { width: 1000, height: 800 },
  prefs: extras.prefs ?? DEFAULT_DISPLAY_PREFS,
  onPrefsChange: extras.onPrefsChange ?? (() => {}),
  openings: extras.openings ?? null,
  openUrl: extras.openUrl ?? (() => {}),
  tab: extras.tab ?? "graph",
});

/** The view as the App would hold it, for `render` or `rerender`. */
export const viewElement = (props: ViewProps) => <StatefulView {...props} />;

export const renderView = (g = game(), onOpenTrace = vi.fn(), extras: ViewExtras = {}) =>
  render(viewElement(viewProps(g, onOpenTrace, extras)));

export const key = (k: string) => fireEvent.keyDown(window, { key: k });

/** The move the board's cursor is on, as the move list marks it, without its eval. */
export function current(): string {
  const move = document.querySelector('[aria-label="move list"] [aria-current="step"]');
  if (!move) return "Start";
  const evaluation = move.querySelector("[data-eval]")?.textContent ?? "";
  return move.textContent!.slice(0, move.textContent!.length - evaluation.length);
}
