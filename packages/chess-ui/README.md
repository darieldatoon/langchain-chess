# @langchain-chess/chess-ui

The chess pieces of the two web apps: the board, the move list, a move's details and analysis,
and the TypeScript mirror of the agent's game state. [`apps/web`](../../apps/web) and
[`apps/review`](../../apps/review) both use it.

It is a private workspace package consumed as TypeScript source: no build step, no dev server of
its own. See a change by running either app.

## Use it from a workspace app

```jsonc
// package.json: React, React DOM and Macaw are the app's own dependencies too
"dependencies": {
  "@langchain-chess/chess-ui": "workspace:*",
  "@langchain/macaw-components": "catalog:",
  "react": "catalog:",
  "react-dom": "catalog:"
}
```

```css
/* the app's stylesheet: Macaw's tokens first, then this package's board colours */
@import "@langchain/macaw-components/styles.css";
@import "@langchain-chess/chess-ui/styles.css";

@tailwind components;
@tailwind utilities;
```

PostCSS runs Tailwind with that config, as in
[`apps/web/postcss.config.cjs`](../../apps/web/postcss.config.cjs).

```js
// tailwind.config.cjs: Macaw's preset, and scan this package too or its classes are purged
module.exports = {
  content: ["./src/**/*.{ts,tsx}", "../../packages/chess-ui/src/**/*.{ts,tsx}"],
  presets: [require("@langchain/macaw-components/tailwind-preset")],
};
```

```tsx
import { TooltipProvider } from "@langchain/macaw-components/Tooltip";
import { Board } from "@langchain-chess/chess-ui";

<TooltipProvider>
  <Board
    fen={fen}
    orientation="white"
    humanSide="white"
    lastMove={null}
    locked={false}
    onMove={(uci, fenAfter) => play(uci)}
  />
</TooltipProvider>;
```

Leave out `onMove` for a board that only shows a position. The promotion picker's buttons use
Macaw tooltips, hence the provider.

## What's in it

Everything but the fixtures imports from the package root.

| Import                                                | What it is                                                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `Board`, `BoardControls`                              | The board (click or drag to move, arrows, highlights, a promotion picker) and first/previous/next/last controls |
| `MoveList`, `usePlyKeys`                              | The numbered move list, and arrow-key navigation through the plies                                              |
| `PlyDetails`, `Analysis`                              | Who played a move, with model, latency, cost and System 1's top moves; the LLM's reasoning as Markdown          |
| `MoveBar`                                             | One of System 1's moves: SAN, probability bar and percentage                                                    |
| Types (`src/types.ts`)                                | `ChessState`, `Ply`, `TurnRecord`, `ChessContext` and friends, mirrored by hand from the Python packages        |
| Helpers (`src/selectors.ts`, `chess.ts`, `format.ts`) | Pure functions: turn cost and System 1 telemetry, legal moves and positions, labels and formatting              |
| `@langchain-chess/chess-ui/testing`                   | Fixture builders for plies, turns and game states                                                               |

`src/types.ts` must change with the Python state in [`libs/chess`](../../libs/chess) and
[`libs/systemone`](../../libs/systemone); nothing checks them against each other.

## Test

```sh
pnpm --dir packages/chess-ui exec vp test --run --coverage
```
