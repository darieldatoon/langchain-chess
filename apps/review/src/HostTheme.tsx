import { AppThemeProvider } from "@langchain/macaw-components/hooks/AppThemeProvider";
import { useColorScheme } from "@langchain/macaw-components/hooks/useColorScheme";
import { TooltipProvider } from "@langchain/macaw-components/Tooltip";
import { useLayoutEffect, type ReactNode } from "react";

export type Mode = "light" | "dark";

// LangSmith owns the theme. `storageKey={null}`: the sandbox has no localStorage.
export function HostTheme({ mode, children }: { mode: Mode; children?: ReactNode }) {
  return (
    <AppThemeProvider defaultMode={mode} storageKey={null}>
      <TooltipProvider>
        <SyncTheme mode={mode}>{children}</SyncTheme>
      </TooltipProvider>
    </AppThemeProvider>
  );
}

/** Follows the host's mode on every render without remounting the app. */
function SyncTheme({ mode, children }: { mode: Mode; children?: ReactNode }) {
  const { setMode } = useColorScheme();
  useLayoutEffect(() => setMode(mode), [mode, setMode]);
  return children;
}
