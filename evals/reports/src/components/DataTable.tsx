import { Text } from "@langchain/macaw-components/Text";
import type { ReactNode } from "react";

interface Props {
  head: readonly string[];
  /** The first cell of each row is its label; the rest are right-aligned figures. */
  rows: readonly (readonly ReactNode[])[];
  highlight?: (row: number) => boolean;
  note?: ReactNode;
}

export function DataTable({ head, rows, highlight, note }: Props) {
  return (
    <div className="flex flex-col gap-space-2">
      <div className="overflow-x-auto rounded-lg border border-muted">
        <table className="w-full text-sm">
          <thead className="bg-surface-level-3 text-secondary">
            <tr>
              {head.map((cell, i) => (
                <th
                  key={cell}
                  className={`px-space-3 py-space-2 font-medium whitespace-nowrap ${i ? "text-right" : "text-left"}`}
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr
                key={r}
                className={`border-t border-muted ${highlight?.(r) ? "bg-surface-level-2" : ""}`}
              >
                {row.map((cell, i) => (
                  <td
                    key={i}
                    className={`px-space-3 py-space-2 whitespace-nowrap ${i ? "text-right tabular-nums" : "text-left text-primary"}`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note && (
        <Text variant="xs" className="text-tertiary">
          {note}
        </Text>
      )}
    </div>
  );
}
