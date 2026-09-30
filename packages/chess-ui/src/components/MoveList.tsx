import { Text } from "@langchain/macaw-components/Text";
import { cn } from "@langchain/macaw-components/utils/cn";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import {
  isAtBottom,
  outcomeLine,
  pairs,
  qualitySymbol,
  scoreText,
  sourceClass,
  type MoveEntry,
} from "../format";
import { ACTIVE_MOVE, QUALITY_CLASSES, SOURCE_CLASSES } from "../moveClasses";
import { drawMarks } from "../selectors";
import type { DrawOffer, Outcome } from "../types";

interface Props {
  entries: MoveEntry[];
  startFen: string;
  /** With `onSelect`, each move is a button and the selected ply is marked. */
  selected?: number | null;
  onSelect?: (ply: number) => void;
  /** A result row after the last move. */
  outcome?: Outcome | null;
  /** A line above the moves, such as the opening. */
  heading?: ReactNode;
  /** Shown after a move's SAN, keyed by ply. */
  after?: (ply: number) => ReactNode;
  /** A full-width row under a move's row, keyed by ply. */
  note?: (ply: number) => ReactNode;
  /** `½?` after the move each was offered after. */
  drawOffers?: readonly DrawOffer[];
}

/** A draw offered here and declined. */
export function DrawMark() {
  return (
    <span className="text-xs text-tertiary" title="Draw offered" aria-label="draw offered">
      ½?
    </span>
  );
}

/**
 * Scrolls the list only: `scrollIntoView` would also scroll the page around it. `center` for a
 * move the reader went to, the end for one that arrived.
 */
function useScrollToMove(selected: number | null, count: number, axis: "y" | "x") {
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // Null until mounted: a list that opens on a long game starts at its selected move.
  const seen = useRef<{ selected: number | null; count: number } | null>(null);
  useLayoutEffect(() => {
    const el = list.current!;
    const previous = seen.current;
    seen.current = { selected, count };
    // A move arriving follows the end only while the reader is there; it never moves a reader
    // who is browsing.
    if (previous && count > previous.count) {
      if (stick.current && (selected === null || selected === count - 1)) {
        if (axis === "y") el.scrollTop = el.scrollHeight;
        else el.scrollLeft = el.scrollWidth;
      }
      return;
    }
    const move = el.querySelector<HTMLElement>("[aria-current=step]");
    if (!move) return;
    const m = move.getBoundingClientRect();
    const l = el.getBoundingClientRect();
    if (axis === "y") el.scrollTop += m.top + m.height / 2 - (l.top + l.height / 2);
    else el.scrollLeft += m.left + m.width / 2 - (l.left + l.width / 2);
  }, [selected, count, axis]);
  const onScroll = (el: HTMLElement) => {
    stick.current =
      axis === "y"
        ? isAtBottom(el)
        : isAtBottom({
            scrollTop: el.scrollLeft,
            scrollHeight: el.scrollWidth,
            clientHeight: el.clientWidth,
          });
  };
  return { list, onScroll };
}

export function MoveList({
  entries,
  startFen,
  selected = null,
  onSelect,
  outcome = null,
  heading,
  after,
  note,
  drawOffers,
}: Props) {
  const rows = pairs(entries, startFen);
  const { list: listRef, onScroll } = useScrollToMove(selected, entries.length, "y");
  const marks = drawMarks(drawOffers);
  const mark = (ply: number) => (
    <>
      {after?.(ply)}
      {marks.has(ply) && <DrawMark />}
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {heading}
      <div
        className="grid min-h-0 flex-1 auto-rows-min grid-cols-[17%_1fr_1fr] content-start overflow-auto font-mono text-sm"
        aria-label="move list"
        ref={listRef}
        onScroll={(e) => onScroll(e.currentTarget)}
      >
        {marks.has(-1) && (
          <span className="col-span-3 px-space-2 py-space-1">
            <DrawMark />
          </span>
        )}
        {rows.length === 0 && (
          <Text variant="sm" color="tertiary" className="col-span-3 p-space-2">
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
            after={mark}
            note={note}
          />
        ))}
        {outcome && (
          <div
            aria-label="result"
            className="col-span-3 mt-space-1 flex flex-wrap items-baseline gap-x-space-2 border-t border-subtle px-space-2 py-space-2 font-sans"
          >
            <Text variant="sm" weight="semibold" as="span">
              {scoreText(outcome)}
            </Text>
            <Text variant="sm" color="secondary" as="span">
              {outcomeLine(outcome)}
            </Text>
          </div>
        )}
      </div>
    </div>
  );
}

interface Selection {
  selected: number | null;
  onSelect: ((ply: number) => void) | undefined;
  after: ((ply: number) => ReactNode) | undefined;
}

function MoveRow({
  num,
  white,
  black,
  note,
  ...selection
}: Selection & {
  num: number;
  white: MoveEntry | undefined;
  black: MoveEntry | undefined;
  note: ((ply: number) => ReactNode) | undefined;
}) {
  const notes = [white, black].flatMap((entry) => {
    const row = entry && note?.(entry.ply);
    return row ? [{ ply: entry.ply, row }] : [];
  });
  return (
    <>
      <span className="bg-surface-level-3 px-space-2 py-space-1 text-center text-tertiary">
        {num}
      </span>
      {white ? (
        <Move entry={white} {...selection} />
      ) : (
        <span className="px-space-2 py-space-1 text-tertiary">{"…"}</span>
      )}
      {black ? <Move entry={black} {...selection} /> : <span />}
      {notes.map(({ ply, row }) => (
        <div key={ply} className="col-span-3">
          {row}
        </div>
      ))}
    </>
  );
}

function MoveText({ entry, after }: { entry: MoveEntry; after: Selection["after"] }) {
  const { quality } = entry;
  const symbol = qualitySymbol(quality);
  return (
    <>
      {entry.san}
      {quality && symbol && <span className={QUALITY_CLASSES[quality]}>{symbol}</span>}
      {after?.(entry.ply)}
    </>
  );
}

function Move({ entry, selected, onSelect, after }: Selection & { entry: MoveEntry }) {
  const className = cn(
    "flex min-w-0 items-center gap-space-1 px-space-2 py-space-1",
    SOURCE_CLASSES[sourceClass(entry.source)],
  );
  if (!onSelect) {
    return (
      <span className={className}>
        <MoveText entry={entry} after={after} />
      </span>
    );
  }
  const current = entry.ply === selected;
  return (
    <button
      type="button"
      className={cn(
        className,
        "text-left hover:bg-surface-level-2-hover [@media(pointer:coarse)]:min-h-11",
        current && ACTIVE_MOVE,
      )}
      aria-current={current ? "step" : undefined}
      onClick={() => onSelect(entry.ply)}
    >
      <MoveText entry={entry} after={after} />
    </button>
  );
}

/** The move list on phones: one horizontal line of 44px moves under the board. */
export function MoveStrip({
  entries,
  startFen,
  selected,
  onSelect,
  drawOffers,
}: {
  entries: MoveEntry[];
  startFen: string;
  selected: number | null;
  onSelect: (ply: number) => void;
  drawOffers?: readonly DrawOffer[];
}) {
  const marks = drawMarks(drawOffers);
  const mark = (ply: number) => marks.has(ply) && <DrawMark />;
  const { list: listRef, onScroll } = useScrollToMove(selected, entries.length, "x");
  const rows = pairs(entries, startFen);
  return (
    <div
      ref={listRef}
      aria-label="move list"
      className="flex h-11 shrink-0 items-center overflow-x-auto font-mono text-sm"
      onScroll={(e) => onScroll(e.currentTarget)}
    >
      {marks.has(-1) && <DrawMark />}
      {rows.length === 0 && (
        <Text variant="sm" color="tertiary" className="px-space-2">
          No moves yet.
        </Text>
      )}
      {rows.map(([num, white, black]) => (
        <span key={num} className="flex shrink-0 items-center">
          <span className="px-space-1 text-tertiary">{white ? `${num}.` : `${num}…`}</span>
          {[white, black].map(
            (entry) =>
              entry && (
                <button
                  key={entry.ply}
                  type="button"
                  aria-current={entry.ply === selected ? "step" : undefined}
                  onClick={() => onSelect(entry.ply)}
                  className={cn(
                    "flex h-11 min-w-11 items-center justify-center rounded-xs px-space-2",
                    SOURCE_CLASSES[sourceClass(entry.source)],
                    entry.ply === selected && ACTIVE_MOVE,
                  )}
                >
                  <MoveText entry={entry} after={mark} />
                </button>
              ),
          )}
        </span>
      ))}
    </div>
  );
}
