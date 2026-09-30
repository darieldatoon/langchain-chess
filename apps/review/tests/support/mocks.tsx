// Stand-ins for components that need real layout or pointer geometry. Each test file installs
// them with `vi.mock` so the mock is hoisted.
import type { ReactNode } from "react";

export const board: { options: Record<string, unknown> | null } = { options: null };

/** The last props each chart was drawn with. */
export const charts: { line: Record<string, unknown> | null; bar: Record<string, unknown> | null } =
  { line: null, bar: null };

/** Every piece as an empty glyph: the strips draw material with them. */
export const pieces = new Proxy({} as Record<string, () => null>, { get: () => () => null });

export function chessboardMock() {
  return {
    defaultPieces: pieces,
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
    }) => {
      charts.line = props;
      return (
        <button
          type="button"
          aria-label={props["aria-label"]}
          data-active={props.activeX}
          data-x={props.formatXValue?.(3)}
          data-y={props.yAxes?.[0]?.formatValue?.(50)}
          onClick={() => props.onDatumPointerDown?.({ x: 3 })}
        />
      );
    },
  };
}

interface Bar {
  id: string;
  category: number;
  value: number | null;
}

/** A button per bar that has a value: hover, leave and click stand in for the pointer. */
export function barChartMock() {
  return {
    BarChart: (props: {
      "aria-label": string;
      series: readonly { id: string; data: readonly Bar[] }[];
      valueAxes?: readonly { formatValue?: (v: number) => string }[];
      getBarAriaLabel?: (bar: Bar) => string | undefined;
      onBarPointerMove?: (bar: Bar) => void;
      onBarPointerOut?: () => void;
      onBarActivate?: (bar: Bar) => void;
    }) => {
      charts.bar = props;
      return (
        <div
          role="group"
          aria-label={props["aria-label"]}
          data-y={props.valueAxes?.[0]?.formatValue?.(2)}
        >
          {props.series.flatMap((s) =>
            s.data
              .filter((bar) => bar.value !== null)
              .map((bar) => (
                <button
                  key={bar.id}
                  type="button"
                  aria-label={props.getBarAriaLabel?.(bar)}
                  onMouseEnter={() => props.onBarPointerMove?.(bar)}
                  onMouseLeave={() => props.onBarPointerOut?.()}
                  onClick={() => props.onBarActivate?.(bar)}
                />
              )),
          )}
        </div>
      );
    },
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
