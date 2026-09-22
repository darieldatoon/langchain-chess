import { pairs, sourceClass } from "../format";
import type { PlyView } from "../types";

export function MoveList({ plies }: { plies: PlyView[] }) {
  const rows = pairs(plies);
  return (
    <section className="card">
      <h2>Moves</h2>
      <div className="moves" aria-label="move list">
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
