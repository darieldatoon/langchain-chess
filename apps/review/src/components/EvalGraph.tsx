import { LineChart } from "@langchain/macaw-components/LineChart";
import { getCategoricalLineChartColor } from "@langchain/macaw-components/utils/chartColors";
import { useMemo } from "react";
import { whiteWinPercent, type Eval } from "../review";

interface Props {
  evals: readonly Eval[];
  /** The position shown on the board: 0 is the start. */
  index: number;
  onSelect: (index: number) => void;
}

const Y_AXIS = [
  {
    id: "win",
    domain: [0, 100] as const,
    tickValues: [0, 50, 100],
    formatValue: (v: number) => `${v}%`,
  },
];

export function EvalGraph({ evals, index, onSelect }: Props) {
  const series = useMemo(
    () => [
      {
        id: "white",
        label: "White's winning chances",
        color: getCategoricalLineChartColor(0),
        points: evals.map((e, x) => ({ x, y: Math.round(whiteWinPercent(e) * 10) / 10 })),
      },
    ],
    [evals],
  );
  return (
    <LineChart
      aria-label="White's winning chances by ply"
      className="h-40"
      series={series}
      yAxes={Y_AXIS}
      xDomain={[0, Math.max(1, evals.length - 1)]}
      formatXValue={(x) => `ply ${x}`}
      activeX={index}
      showLegend={false}
      shouldAnimate={false}
      onDatumPointerDown={(datum) => onSelect(datum.x)}
    />
  );
}
