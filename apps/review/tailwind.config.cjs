// Semantic utilities come from the Macaw preset; the shared components' classes live in
// packages/chess-ui.
module.exports = {
  content: ["./src/**/*.{ts,tsx}", "../../packages/chess-ui/src/**/*.{ts,tsx}"],
  presets: [require("@langchain/macaw-components/tailwind-preset")],
};
