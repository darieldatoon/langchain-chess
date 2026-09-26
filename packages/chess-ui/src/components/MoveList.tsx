import { Card } from "@langchain/macaw-components/Card";
import { Text } from "@langchain/macaw-components/Text";
import { cn } from "@langchain/macaw-components/utils/cn";
import { useEffect, useRef } from "react";
import { isAtBottom, pairs, sourceClass, type MoveEntry, type SourceClass } from "../format";

const SOURCE_CLASSES: Record<SourceClass, string> = {
  external: "",
  systemone: "bg-brand-subtle text-brand-primary",
  llm: "bg-purple text-purple",
  forced: "bg-surface-level-3 text-secondary",
  other: "bg-warning-subtle text-warning-secondary",
};

export function MoveList({ entries, startFen }: { entries: MoveEntry[]; startFen: string }) {
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
          <MoveRow key={num} num={num} white={white} black={black} />
        ))}
      </div>
    </Card>
  );
}

function MoveRow({
  num,
  white,
  black,
}: {
  num: number;
  white: MoveEntry | undefined;
  black: MoveEntry | undefined;
}) {
  return (
    <>
      <span className="text-tertiary">{num}.</span>
      {white ? <Move entry={white} /> : <span className="text-tertiary">{"\u2026"}</span>}
      {black ? <Move entry={black} /> : <span />}
    </>
  );
}

function Move({ entry }: { entry: MoveEntry }) {
  return (
    <span className={cn("rounded-xs px-space-1", SOURCE_CLASSES[sourceClass(entry.source)])}>
      {entry.san}
    </span>
  );
}
