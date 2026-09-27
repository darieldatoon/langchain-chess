import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Report, { title } from "@report";
import { followSystemTheme } from "./theme";

followSystemTheme(window, document.documentElement);
document.title = title;
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Report />
  </StrictMode>,
);
