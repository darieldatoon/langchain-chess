// Stand-ins for components that need real layout or pointer geometry. Each test file installs
// them with `vi.mock` so the mock is hoisted.
import type { ReactNode } from "react";

export const board: { options: Record<string, unknown> | null } = { options: null };

export function chessboardMock() {
  return {
    Chessboard: ({ options }: { options: Record<string, unknown> }) => {
      board.options = options;
      return <div data-testid="board" data-position={String(options.position)} />;
    },
  };
}

/** Clicking the chart jumps to ply 3, as a pointer down on that datum would. */
export function lineChartMock() {
  return {
    LineChart: (props: {
      "aria-label": string;
      activeX?: number;
      formatXValue?: (x: number) => string;
      yAxes?: readonly { formatValue?: (v: number) => string }[];
      onDatumPointerDown?: (datum: { x: number }) => void;
    }) => (
      <button
        type="button"
        aria-label={props["aria-label"]}
        data-active={props.activeX}
        data-x={props.formatXValue?.(3)}
        data-y={props.yAxes?.[0]?.formatValue?.(50)}
        onClick={() => props.onDatumPointerDown?.({ x: 3 })}
      />
    ),
  };
}

interface Option {
  value: string;
  label?: string;
}

export function selectMock() {
  return {
    Select: ({
      options,
      value,
      onChange,
      "aria-label": label,
    }: {
      options: readonly Option[];
      value?: string;
      onChange: (v: string | undefined) => void;
      "aria-label"?: string;
      children?: ReactNode;
    }) => (
      <select
        aria-label={label}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      >
        <option value="">(none)</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label ?? o.value}
          </option>
        ))}
      </select>
    ),
  };
}
