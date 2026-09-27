import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, lazyPlugins } from "vite-plus";

// `@report` is the one report being built; scripts/build.mjs points it at each report in turn.
// Tests render a fixture instead.
export default defineConfig({
  resolve: {
    alias: {
      "@report": fileURLToPath(new URL("./tests/support/FixtureReport.tsx", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./tests/support/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      // Reports are one-off snapshots: a render test covers them, the coverage gate doesn't.
      exclude: ["src/**/*.d.ts", "src/experiments/**"],
      reportsDirectory: "../../node_modules/.coverage/reports",
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
      reporter: ["text"],
    },
  },
  plugins: lazyPlugins(() => [react()]),
});
