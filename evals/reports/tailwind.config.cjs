// Semantic utilities come from the Macaw preset; the board's classes live in packages/chess-ui.
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}", "../../packages/chess-ui/src/**/*.{ts,tsx}"],
  presets: [require("@langchain/macaw-components/tailwind-preset")],
};
