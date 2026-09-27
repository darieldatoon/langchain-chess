/** Macaw's dark theme is `html.dark`; a report follows the reader's system setting, live. */
export function followSystemTheme(win: Window, html: HTMLElement): void {
  const query = win.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => html.classList.toggle("dark", query.matches);
  apply();
  query.addEventListener("change", apply);
}
