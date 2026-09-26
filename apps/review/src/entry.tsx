import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createApi } from "./api";
import { App } from "./App";
import { HostTheme, type Mode } from "./HostTheme";
import css from "./index.css?inline";

export interface RenderMetadata {
  mode: Mode;
}

let root: Root | null = null;
let styled = false;

// The sandbox evaluates one CommonJS file and calls this on every host update, so the root and
// the stylesheet are created once and the app re-renders in place.
export function render(_data: unknown, container: HTMLElement, metadata: RenderMetadata) {
  if (!styled) {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    styled = true;
  }
  root ??= createRoot(container);
  root.render(
    createElement(
      HostTheme,
      { mode: metadata.mode },
      createElement(App, {
        api: createApi(window.langsmith.call),
        openUrl: window.langsmith.openUrl.bind(window.langsmith),
      }),
    ),
  );
}

// Some sandbox hosts call a bare default export.
const entry = { render };
export default entry;
