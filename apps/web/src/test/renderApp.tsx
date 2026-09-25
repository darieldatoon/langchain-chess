import { AppThemeProvider } from "@langchain/macaw-components/hooks/AppThemeProvider";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";

/** The same providers main.tsx mounts, so Macaw tooltips and the theme hook work in tests. */
export function renderWithProviders(ui: ReactNode) {
  return render(
    <AppThemeProvider storageKey={null}>
      <TooltipProvider>{ui}</TooltipProvider>
    </AppThemeProvider>,
  );
}
