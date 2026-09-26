import { BarChart } from "@langchain/macaw-components/BarChart";
import { ChartCard } from "@langchain/macaw-components/ChartCard";
import { CHART_OTHER_COLOR } from "@langchain/macaw-components/utils/chartColors";
import type { ReactNode } from "react";
import { pct } from "../format";
import { valueLabel } from "./valueLabel";

export interface RunBar {
  label: string;
  value: number | null;
  /** A Macaw chart colour token. */
  color: string;
}

interface Props {
  title: string;
  description?: ReactNode;
  bars: readonly RunBar[];
  /** The value axis runs from 0 to `max`. */
  max?: number;
  format?: (value: number) => string;
  /** Shades 0 to this value, e.g. what random guessing would score. */
  chance?: number;
}

/** One horizontal bar per run. */
export function RunBarChart({ title, description, bars, max = 1, format = pct, chance }: Props) {
  return (
    <ChartCard title={title} description={description}>
      <BarChart
        className="h-64"
        aria-label={`${title}: ${bars.map((b) => `${b.label} ${b.value == null ? "none" : format(b.value)}`).join(", ")}`}
        orientation="horizontal"
        showLegend={false}
        series={[
          {
            id: "value",
            label: title,
            data: bars.map((b) => ({ category: b.label, value: b.value, color: b.color })),
          },
        ]}
        categoryAxis={{ domain: bars.map((b) => b.label), thickness: 160 }}
        valueAxes={[{ id: "value", domain: [0, max], formatValue: format }]}
        valueBands={
          chance == null
            ? undefined
            : [
                {
                  id: "chance",
                  from: 0,
                  to: chance,
                  color: CHART_OTHER_COLOR,
                  opacity: 0.35,
                  ariaLabel: `chance ${format(chance)}`,
                },
              ]
        }
        shouldAnimate={false}
        // A report is read, not hovered: print every value at the end of its bar.
        plotPadding={{ right: 56 }}
        slots={{ barLabel: valueLabel(format) }}
      />
    </ChartCard>
  );
}
