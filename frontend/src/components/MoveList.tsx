import { useEffect, useRef } from "react";
import { isAtBottom, pairs, sourceClass } from "../format";
import type { PlyView } from "../types";

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
    <section className="card">
      <h2>Moves</h2>
      <div
        className="moves"
        aria-label="move list"
        ref={listRef}
        onScroll={(e) => {
          stickRef.current = isAtBottom(e.currentTarget);
        }}
      >
        {rows.length === 0 && <span className="empty">No moves yet.</span>}
        {rows.map(([num, white, black]) => (
          <MoveRow key={num} num={num} white={white} black={black} />
        ))}
      </div>
    </section>
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
      <span className="num">{num}.</span>
      <span className={`san ${sourceClass(white?.source)}`}>{white?.san}</span>
      <span className={`san ${sourceClass(black?.source)}`}>{black?.san ?? ""}</span>
    </>
  );
}
