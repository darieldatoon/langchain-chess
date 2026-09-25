// Semantic utilities (bg-surface-level-2, text-secondary, gap-space-4, ...) come from the
// Macaw preset; the component stylesheet is imported separately in src/index.css.
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  presets: [require("@langchain/macaw-components/tailwind-preset")],
};
