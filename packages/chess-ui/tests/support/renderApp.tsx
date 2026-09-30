import { AppThemeProvider } from "@langchain/macaw-components/hooks/AppThemeProvider";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * The same providers main.tsx mounts, so Macaw tooltips and the theme hook work in tests. A
 * wrapper, so `rerender` keeps them.
 */
export function renderWithProviders(ui: ReactNode) {
  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <AppThemeProvider storageKey={null}>
        <TooltipProvider>{children}</TooltipProvider>
      </AppThemeProvider>
    ),
  });
}
