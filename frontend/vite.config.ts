import react from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";

// Served by the Agent Server under /ui (see src/jev_chess/server/app.py), so the bundle is
// built straight into the Python package and every asset URL is prefixed.
export default defineConfig({
  base: "/ui/",
  build: {
    outDir: "../src/jev_chess/server/static",
    emptyOutDir: true,
  },
  fmt: {},
  lint: {
    plugins: ["react", "typescript", "oxc"],
    rules: {
      "react/rules-of-hooks": "error",
      "react/only-export-components": [
        "warn",
        {
          allowConstantExport: true,
        },
      ],
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
    ignorePatterns: ["coverage/**"],
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/**/*.d.ts"],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
      reporter: ["text", "html"],
    },
  },
  plugins: lazyPlugins(() => [react()]),
});
