import { AppThemeProvider } from "@langchain/macaw-components/hooks/AppThemeProvider";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import Root from "./Root.tsx";

export function mount(root: HTMLElement) {
  createRoot(root).render(
    <StrictMode>
      <AppThemeProvider>
        <TooltipProvider>
          <Root />
        </TooltipProvider>
      </AppThemeProvider>
    </StrictMode>,
  );
}

const root = document.getElementById("root");
if (root) mount(root);
