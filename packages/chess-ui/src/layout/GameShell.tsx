import type { ReactNode } from "react";
import { STRIP_GAP, type Allocation } from "./sizing";

export interface ShellSlots {
  /** `full` only: the first column. */
  left?: ReactNode;
  topStrip: ReactNode;
  board: ReactNode;
  bottomStrip: ReactNode;
  evalBar?: ReactNode;
  /** Beside the board on `full` and `wide`, exactly as tall as the board and its strips. */
  table?: ReactNode;
  /** Under the table on `full`, above `under` on `wide`, after the table on `phone`. */
  underTable?: ReactNode;
  /** Under the board on `full`, under everything on `wide` and `phone`. */
  under?: ReactNode;
  phoneBar?: ReactNode;
  phoneMoves?: ReactNode;
  phoneReply?: ReactNode;
  phoneTabs?: ReactNode;
}

interface Props extends ShellSlots {
  allocation: Allocation;
}

/** Places the slots for a layout. Sizes come from `allocate`; this only arranges. */
export function GameShell({ allocation: a, ...slots }: Props) {
  const boardColumn = (
    <div className="flex shrink-0 flex-col" style={{ width: a.board, gap: STRIP_GAP }}>
      <div data-slot="top-strip" style={{ height: a.strip }}>
        {slots.topStrip}
      </div>
      <div data-slot="board" style={{ width: a.board, height: a.board }}>
        {slots.board}
      </div>
      <div data-slot="bottom-strip" style={{ height: a.strip }}>
        {slots.bottomStrip}
      </div>
    </div>
  );
  const evalBar = slots.evalBar && (
    <div
      data-slot="eval-bar"
      className="shrink-0"
      style={{ width: a.evalBar, height: a.board, marginTop: a.strip + STRIP_GAP }}
    >
      {slots.evalBar}
    </div>
  );

  const underTable = slots.underTable && <div data-slot="under-table">{slots.underTable}</div>;

  if (a.layout === "phone") {
    return (
      <div data-layout="phone" className="flex min-w-0 flex-col" style={{ gap: a.gap }}>
        <div className="flex justify-center" style={{ gap: a.gap }}>
          {evalBar}
          {boardColumn}
        </div>
        {slots.phoneBar}
        {slots.phoneMoves}
        {slots.phoneReply}
        {slots.table && <div data-slot="table">{slots.table}</div>}
        {underTable}
        {slots.phoneTabs}
        {slots.under && <div data-slot="under">{slots.under}</div>}
      </div>
    );
  }

  const full = a.layout === "full";
  return (
    <div data-layout={a.layout} className="flex min-w-0 flex-col" style={{ gap: a.gap }}>
      <div className="flex items-start justify-center" style={{ gap: a.gap }}>
        {full && slots.left && (
          <div
            data-slot="left"
            className="flex shrink-0 flex-col gap-space-4"
            style={{ width: a.left }}
          >
            {slots.left}
          </div>
        )}
        {evalBar}
        <div className="flex shrink-0 flex-col" style={{ gap: a.gap }}>
          {boardColumn}
          {full && slots.under && (
            <div data-slot="under" style={{ width: a.board }}>
              {slots.under}
            </div>
          )}
        </div>
        {slots.table && (
          <div className="flex shrink-0 flex-col" style={{ width: a.table, gap: a.gap }}>
            <div
              data-slot="table"
              className="flex min-h-0 shrink-0 flex-col"
              style={{ height: a.column }}
            >
              {slots.table}
            </div>
            {full && underTable}
          </div>
        )}
      </div>
      {!full && underTable}
      {!full && slots.under && <div data-slot="under">{slots.under}</div>}
    </div>
  );
}
