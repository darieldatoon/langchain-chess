import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createApi, type Api } from "./api";
import { App, type OpenUrl } from "./App";
import { HostTheme, type Mode } from "./HostTheme";
import css from "./index.css?inline";

export interface RenderMetadata {
  mode: Mode;
}

let root: Root | null = null;
let styled = false;
let deps: { api: Api; openUrl: OpenUrl } | null = null;

// The sandbox evaluates one CommonJS file and calls this on every host update, so the root, the
// stylesheet and the app's dependencies are created once and the app re-renders in place. A new
// `api` would re-run App's loads and reset the chosen project.
export function render(_data: unknown, container: HTMLElement, metadata: RenderMetadata) {
  if (!styled) {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    styled = true;
  }
  root ??= createRoot(container);
  deps ??= {
    api: createApi(window.langsmith.call),
    openUrl: window.langsmith.openUrl.bind(window.langsmith),
  };
  root.render(createElement(HostTheme, { mode: metadata.mode }, createElement(App, deps)));
}

// Some sandbox hosts call a bare default export.
const entry = { render };
export default entry;
