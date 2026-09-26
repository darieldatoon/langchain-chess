import { Board, type Side } from "@langchain-chess/chess-ui";
import { Badge } from "@langchain/macaw-components/Badge";
import { Card } from "@langchain/macaw-components/Card";
import { Text } from "@langchain/macaw-components/Text";
import {
  CHART_STATUS_COLORS,
  useChartColorResolver,
} from "@langchain/macaw-components/utils/chartColors";
import type { ReactNode } from "react";
import { pct } from "../format";
import { ExternalLink } from "./ExternalLink";
import { Eyebrow } from "./Section";

export interface EngineMove {
  san: string;
  /** Pawns for the side to move, preformatted: "+1.6", "mate in 3". */
  eval: string;
}

export interface RankedMove {
  san: string;
  probability: number;
  /** Where the engine ranks this move; 1 is its best. */
  engineRank: number;
}

export interface RunPick {
  label: string;
  /** The run in LangSmith. */
  url: string;
  /** The run's top pick, UCI. */
  top: string;
  moves: readonly RankedMove[];
}

interface Props {
  title: string;
  tags: readonly string[];
  fen: string;
  /** UCI; highlighted on the board. */
  lastMove: string | null;
  orientation: Side;
  /** The engine's best move, UCI. */
  best: string;
  engine: readonly EngineMove[];
  picks: readonly RunPick[];
  gameUrl: string;
  positionId: string;
  /** Who moved and what they played. */
  context: ReactNode;
  children: ReactNode;
}

// At most two runs per example: the first pick's arrow is negative, the second's a warning.
const PICK_COLORS = [CHART_STATUS_COLORS.negative, CHART_STATUS_COLORS.warning];

export function PositionExample(props: Props) {
  const { title, tags, fen, lastMove, orientation, best, engine, picks } = props;
  const resolve = useChartColorResolver();
  const arrow = (uci: string, color: string) => ({
    startSquare: uci.slice(0, 2),
    endSquare: uci.slice(2, 4),
    color: resolve(color),
  });
  const misses = picks.map((p, i) => ({ ...p, color: PICK_COLORS[i] ?? PICK_COLORS[1] }));
  const arrows = [
    arrow(best, CHART_STATUS_COLORS.positive),
    ...misses.filter((p) => p.top !== best).map((p) => arrow(p.top, p.color)),
  ];

  return (
    <Card className="flex flex-col gap-space-4">
      <div className="flex flex-wrap items-center gap-space-2">
        <Text variant="h5">Example: {title}</Text>
        {tags.map((tag) => (
          <Badge key={tag} color={tag === "Tactic" ? "warning" : undefined}>
            {tag}
          </Badge>
        ))}
      </div>
      <div className="grid gap-space-5 md:grid-cols-[300px_1fr]">
        <div className="flex flex-col gap-space-2">
          <div className="w-full max-w-[300px]">
            <Board
              fen={fen}
              orientation={orientation}
              humanSide={orientation}
              lastMove={lastMove}
              locked
              arrows={arrows}
            />
          </div>
          <div className="flex flex-wrap gap-space-3 text-xs text-tertiary">
            <Swatch color={CHART_STATUS_COLORS.positive}>Engine's best</Swatch>
            {misses.map((p) =>
              p.top === best ? (
                <span key={p.label}>{p.label} agrees</span>
              ) : (
                <Swatch key={p.label} color={p.color}>
                  {p.label}'s pick
                </Swatch>
              ),
            )}
          </div>
        </div>
        <div className="flex flex-col gap-space-4">
          <Text variant="body" className="text-secondary">
            {props.context}
          </Text>
          <Text variant="body" className="text-secondary">
            {props.children}
          </Text>
          <div className="grid gap-space-4 sm:grid-cols-2">
            <MoveColumn title="Engine, best first">
              {engine.map((m, i) => (
                <li key={m.san} className="flex items-center gap-space-2 text-sm">
                  <span className="w-4 text-tertiary tabular-nums">{i + 1}</span>
                  <span className="font-mono font-medium text-primary">{m.san}</span>
                  <span className="text-tertiary tabular-nums">{m.eval}</span>
                </li>
              ))}
            </MoveColumn>
            {picks.map((p) => (
              <MoveColumn key={p.label} title={`${p.label}, top ${p.moves.length}`}>
                {p.moves.map((m) => (
                  <li key={m.san} className="flex items-center gap-space-2 text-sm">
                    <span
                      className={`font-mono font-medium ${m.engineRank === 1 ? "text-success-primary" : "text-primary"}`}
                    >
                      {m.san}
                    </span>
                    <span className="text-tertiary tabular-nums">{pct(m.probability)}</span>
                    <span className="text-xs text-tertiary">engine #{m.engineRank}</span>
                  </li>
                ))}
              </MoveColumn>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-space-4 gap-y-space-1 text-sm">
            {picks.map((p) => (
              <ExternalLink key={p.label} href={p.url}>
                {p.label} run in LangSmith
              </ExternalLink>
            ))}
            <ExternalLink href={props.gameUrl}>Game on Lichess</ExternalLink>
          </div>
          <Text variant="xs" className="text-tertiary">
            Position {props.positionId}. Evals are in pawns for the side to move.
          </Text>
        </div>
      </div>
    </Card>
  );
}

function Swatch({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-space-1">
      <span className="inline-block h-1 w-3 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}

function MoveColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-space-1">
      <Eyebrow>{title}</Eyebrow>
      <ol className="flex flex-col gap-space-1">{children}</ol>
    </div>
  );
}
