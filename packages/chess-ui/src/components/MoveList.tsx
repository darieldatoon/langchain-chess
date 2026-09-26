import { Card } from "@langchain/macaw-components/Card";
import { Text } from "@langchain/macaw-components/Text";
import { cn } from "@langchain/macaw-components/utils/cn";
import { useEffect, useRef } from "react";
import {
  isAtBottom,
  pairs,
  qualitySymbol,
  sourceClass,
  type MoveEntry,
  type SourceClass,
} from "../format";
import type { Quality } from "../types";

const SOURCE_CLASSES: Record<SourceClass, string> = {
  external: "",
  systemone: "bg-brand-subtle text-brand-primary",
  llm: "bg-purple text-purple",
  forced: "bg-surface-level-3 text-secondary",
  other: "bg-warning-subtle text-warning-secondary",
};

const QUALITY_CLASSES: Record<Quality, string> = {
  best: "",
  good: "",
  inaccuracy: "text-warning-secondary",
  mistake: "text-warning-primary",
  blunder: "text-error-primary",
};

interface Props {
  entries: MoveEntry[];
  startFen: string;
  /** With `onSelect`, each move is a button and the selected ply is marked. */
  selected?: number | null;
  onSelect?: (ply: number) => void;
}

export function MoveList({ entries, startFen, selected = null, onSelect }: Props) {
  const rows = pairs(entries, startFen);
  const listRef = useRef<HTMLDivElement>(null);
  // Follow new moves only while the reader is already at the bottom; a manual scroll up holds.
  const stickRef = useRef(true);

  useEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  return (
    <Card intent="neutral" className="flex flex-col gap-space-3">
      <Text variant="h4" as="h2" color="secondary">
        Moves
      </Text>
      <div
        className="grid max-h-56 grid-cols-[3ch_1fr_1fr] gap-x-space-3 gap-y-space-1 overflow-auto font-mono text-xs"
        aria-label="move list"
        ref={listRef}
        onScroll={(e) => {
          stickRef.current = isAtBottom(e.currentTarget);
        }}
      >
        {rows.length === 0 && (
          <Text variant="sm" color="tertiary" className="col-span-3">
            No moves yet.
          </Text>
        )}
        {rows.map(([num, white, black]) => (
          <MoveRow
            key={num}
            num={num}
            white={white}
            black={black}
            selected={selected}
            onSelect={onSelect}
          />
        ))}
      </div>
    </Card>
  );
}

interface Selection {
  selected: number | null;
  onSelect: ((ply: number) => void) | undefined;
}

function MoveRow({
  num,
  white,
  black,
  ...selection
}: Selection & {
  num: number;
  white: MoveEntry | undefined;
  black: MoveEntry | undefined;
}) {
  return (
    <>
      <span className="text-tertiary">{num}.</span>
      {white ? (
        <Move entry={white} {...selection} />
      ) : (
        <span className="text-tertiary">{"\u2026"}</span>
      )}
      {black ? <Move entry={black} {...selection} /> : <span />}
    </>
  );
}

function Move({ entry, selected, onSelect }: Selection & { entry: MoveEntry }) {
  const className = cn("rounded-xs px-space-1", SOURCE_CLASSES[sourceClass(entry.source)]);
  const { quality } = entry;
  const text = (
    <>
      {entry.san}
      {quality && qualitySymbol(quality) && (
        <span className={QUALITY_CLASSES[quality]}>{qualitySymbol(quality)}</span>
      )}
    </>
  );
  if (!onSelect) return <span className={className}>{text}</span>;
  return (
    <SelectableMove
      className={className}
      current={entry.ply === selected}
      onClick={() => onSelect(entry.ply)}
    >
      {text}
    </SelectableMove>
  );
}

function SelectableMove({
  className,
  current,
  onClick,
  children,
}: {
  className: string;
  current: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // Scrolls the list only: scrollIntoView would also scroll the page around it.
  useEffect(() => {
    const move = ref.current;
    const list = move?.parentElement;
    if (!current || !move || !list) return;
    const m = move.getBoundingClientRect();
    const l = list.getBoundingClientRect();
    if (m.top < l.top) list.scrollTop -= l.top - m.top;
    else if (m.bottom > l.bottom) list.scrollTop += m.bottom - l.bottom;
  }, [current]);
  return (
    <button
      ref={ref}
      type="button"
      className={cn(className, "text-left", current && "ring-2 ring-inset ring-brand")}
      aria-current={current ? "step" : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
