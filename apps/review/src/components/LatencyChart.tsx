import { BarChart } from "@langchain/macaw-components/BarChart";
import { Text } from "@langchain/macaw-components/Text";
import { getCategoricalFillChartColor } from "@langchain/macaw-components/utils/chartColors";
import {
  costText,
  moveLabel,
  sourceLabel,
  type Ply,
  type TurnRecord,
} from "@langchain-chess/chess-ui";
import { useMemo, useState } from "react";
import { barCost, latencyBars, type LatencyBar } from "../tools";

interface Props {
  plies: readonly Ply[];
  turns: readonly TurnRecord[];
  startFen: string;
  index: number;
  onSelect: (index: number) => void;
}

const SOURCES = ["systemone", "llm", "forced"];
const VALUE_AXES = [{ id: "seconds", formatValue: (v: number) => `${v} s` }];

/** Each agent ply's turn latency, by source; the readout shows the bar under the pointer. */
export function LatencyChart({ plies, turns, startFen, index, onSelect }: Props) {
  const bars = useMemo(() => latencyBars(plies, turns), [plies, turns]);
  const [hovered, setHovered] = useState<number | null>(null);
  const byIndex = new Map(bars.map((bar) => [bar.index, bar]));
  const label = (bar: LatencyBar) => moveLabel(startFen, bar.index - 1, bar.label);
  const describe = (bar: LatencyBar) =>
    bar.seconds === null
      ? `${label(bar)} · ${sourceLabel(bar.source)} · no agent turn`
      : `${label(bar)} · ${sourceLabel(bar.source)} · ${bar.seconds.toFixed(1)} s · ${costText(barCost(bar)).text}`;
  // A source's colour comes from its rank, so it keeps it from game to game.
  const present = [...new Set(bars.filter((b) => b.seconds !== null).map((b) => b.source))];
  const others = present.filter((source) => !SOURCES.includes(source));
  const rank = (source: string) =>
    SOURCES.includes(source) ? SOURCES.indexOf(source) : SOURCES.length + others.indexOf(source);
  const series = present
    .sort((a, b) => rank(a) - rank(b))
    .map((source) => ({
      id: source,
      label: sourceLabel(source),
      color: getCategoricalFillChartColor(rank(source)),
      data: bars
        .filter((bar) => bar.source === source)
        .map((bar) => ({ id: String(bar.index), category: bar.index, value: bar.seconds })),
    }));
  const readout = byIndex.get(hovered ?? index);
  if (series.length === 0) {
    return (
      <Text variant="sm" color="tertiary">
        No agent moves to time.
      </Text>
    );
  }
  return (
    <div className="flex flex-col gap-space-1">
      <BarChart
        aria-label="Agent latency by ply"
        className="h-40"
        mode="stacked"
        series={series}
        showLegend
        shouldAnimate={false}
        categoryAxis={{ domain: bars.map((b) => b.index), tickCount: 8 }}
        valueAxes={VALUE_AXES}
        activeCategory={index}
        getBarAriaLabel={(bar) => describe(byIndex.get(Number(bar.category))!)}
        onBarPointerMove={(bar) => setHovered(Number(bar.category))}
        onBarPointerOut={() => setHovered(null)}
        onBarActivate={(bar) => onSelect(Number(bar.category))}
      />
      <Text variant="xs" color="secondary" aria-label="latency readout" className="min-h-[1lh]">
        {readout ? describe(readout) : ""}
      </Text>
    </div>
  );
}
