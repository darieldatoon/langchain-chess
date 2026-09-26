import react from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";

// Served by the Agent Server under /ui (see apps/server/langchain_chess_server/app.py), so the bundle is
// built straight into the Python package and every asset URL is prefixed.
export default defineConfig({
  base: "/ui/",
  build: {
    outDir: "../server/langchain_chess_server/static",
    emptyOutDir: true,
    // Vendor code in its own long-lived chunks, so an app-only change re-downloads only the
    // app. Markdown is loaded lazily (components/Analysis.tsx) and gets its own chunk anyway.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react",
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 40,
            },
            {
              name: "langchain",
              test: /[\\/]node_modules[\\/](@langchain[\\/](react|langgraph-sdk|core)|langsmith)[\\/]/,
              priority: 30,
            },
            {
              name: "chessboard",
              test: /[\\/]node_modules[\\/](react-chessboard|chess\.js|@dnd-kit[\\/][^\\/]+)[\\/]/,
              priority: 20,
            },
            // No catch-all vendor group: it would pull the lazy Markdown chunk back in.
            {
              name: "ui",
              test: /[\\/]node_modules[\\/](@langchain[\\/]macaw-[^\\/]+|@radix-ui[\\/][^\\/]+|@floating-ui[\\/][^\\/]+|@phosphor-icons[\\/]react|tailwind-merge)[\\/]/,
              priority: 10,
            },
          ],
        },
      },
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
      exclude: ["src/**/*.d.ts"],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
      reporter: ["text", "html"],
    },
  },
  plugins: lazyPlugins(() => [react()]),
});
