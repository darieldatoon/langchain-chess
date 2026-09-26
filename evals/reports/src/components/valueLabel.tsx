import type { BarChartRenderedBar } from "@langchain/macaw-components/BarChart";

/** Draws a bar's value just past its end. */
export function valueLabel(format: (value: number) => string) {
  return (bar: BarChartRenderedBar) => (
    <text
      x={bar.x + bar.width + 6}
      y={bar.y + bar.height / 2}
      dy="0.35em"
      className="fill-current text-xs font-semibold text-primary"
    >
      {format(bar.value)}
    </text>
  );
}
