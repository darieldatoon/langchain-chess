import { LineChart } from "@langchain/macaw-components/LineChart";
import {
  CHART_STATUS_COLORS,
  CHART_STATUS_FILL_COLORS,
  getCategoricalLineChartColor,
} from "@langchain/macaw-components/utils/chartColors";
import { useMemo } from "react";
import { whiteWinPercent, type Eval, type PlyGrade } from "../review";
import { FLAW_LABELS, FLAWS, type Flaw } from "../tools";

interface Props {
  evals: readonly Eval[];
  grades: readonly PlyGrade[];
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

const FLAW_COLORS: Record<Flaw, string> = {
  inaccuracy: CHART_STATUS_COLORS.warning,
  mistake: CHART_STATUS_FILL_COLORS.warning,
  blunder: CHART_STATUS_COLORS.negative,
};

export function EvalGraph({ evals, grades, index, onSelect }: Props) {
  const series = useMemo(() => {
    const win = evals.map((e) => Math.round(whiteWinPercent(e) * 10) / 10);
    return [
      {
        id: "white",
        label: "White's winning chances",
        color: getCategoricalLineChartColor(0),
        points: win.map((y, x) => ({ x, y })),
      },
      // A point per flawed move, on the line, at the position it reached. `LineChart` joins the
      // nulls and strokes every series, so these must keep a zero stroke.
      ...FLAWS.map((flaw) => {
        const at = new Set(grades.filter((g) => g.quality === flaw).map((g) => g.ply + 1));
        return {
          id: flaw,
          label: FLAW_LABELS[flaw],
          color: FLAW_COLORS[flaw],
          strokeWidth: 0,
          points: win.map((y, x) => ({ x, y: at.has(x) ? y : null })),
        };
      }),
    ];
  }, [evals, grades]);
  return (
    <LineChart
      aria-label="White's winning chances by ply"
      className="h-40"
      series={series}
      yAxes={Y_AXIS}
      xDomain={[0, Math.max(1, evals.length - 1)]}
      formatXValue={(x) => `ply ${x}`}
      activeX={index}
      showPoints
      showLegend={false}
      shouldAnimate={false}
      onDatumPointerDown={(datum) => onSelect(datum.x)}
    />
  );
}
