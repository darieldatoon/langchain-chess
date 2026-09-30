import { useState, type ComponentProps } from "react";
import { GameView } from "../../src/components/GameView";
import { HostTheme } from "../../src/HostTheme";
import type { ReviewTab } from "../../src/tools";

export type ViewProps = Omit<ComponentProps<typeof GameView>, "tab" | "onTabChange"> & {
  tab: ReviewTab;
};

/** The view with the App's part: it keeps the tab and the reply card's toggles. */
export function StatefulView({ tab: first, ...props }: ViewProps) {
  const [tab, setTab] = useState(first);
  const [view, setView] = useState(props.view);
  return (
    <HostTheme mode="light">
      <GameView {...props} view={view} onViewChange={setView} tab={tab} onTabChange={setTab} />
    </HostTheme>
  );
}
