import { Card } from "@langchain/macaw-components/Card";
import { Text } from "@langchain/macaw-components/Text";
import { cn } from "@langchain/macaw-components/utils/cn";
import { useEffect, useRef } from "react";
import { isAtBottom, pairs, sourceClass } from "../format";
import type { PlyView } from "../types";

const SOURCE_CLASSES: Record<string, string> = {
  jev: "bg-brand-subtle text-brand-primary",
  llm: "bg-purple text-purple",
  fallback: "bg-error-subtle text-error-secondary",
  engine: "bg-surface-level-3 text-secondary",
};

export function MoveList({ plies }: { plies: PlyView[] }) {
  const rows = pairs(plies);
  const listRef = useRef<HTMLDivElement>(null);
  // Follow new moves only while the reader is already at the bottom; a manual scroll up holds.
  const stickRef = useRef(true);

  useEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [plies.length]);

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
  white: PlyView | undefined;
  black: PlyView | undefined;
}) {
  return (
    <>
      <span className="text-tertiary">{num}.</span>
      <span className={cn("rounded-xs px-space-1", SOURCE_CLASSES[sourceClass(white?.source)])}>
        {white?.san}
      </span>
      <span className={cn("rounded-xs px-space-1", SOURCE_CLASSES[sourceClass(black?.source)])}>
        {black?.san ?? ""}
      </span>
    </>
  );
}
