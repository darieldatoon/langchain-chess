import { AppThemeProvider } from "@langchain/macaw-components/hooks/AppThemeProvider";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { RenderApp } from "./RenderApp";

// LangSmith sends no theme, so follow the system's; never the web UI's stored choice.
export function mount(root: HTMLElement) {
  createRoot(root).render(
    <StrictMode>
      <AppThemeProvider storageKey={null}>
        <TooltipProvider>
          <RenderApp />
        </TooltipProvider>
      </AppThemeProvider>
    </StrictMode>,
  );
}

const root = document.getElementById("root");
if (root) mount(root);
