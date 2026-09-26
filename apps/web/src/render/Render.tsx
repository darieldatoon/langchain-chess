import { Banner } from "@langchain/macaw-components/Banner";
import { Button } from "@langchain/macaw-components/Button";
import { Text } from "@langchain/macaw-components/Text";
import {
  CHART_STATUS_COLORS,
  getCategoricalLineChartColor,
  useChartColorResolver,
} from "@langchain/macaw-components/utils/chartColors";
import { Board, fullmoveNumber, MoveBar, percent, sanAt, seconds } from "@langchain-chess/chess-ui";
import { useState, type ReactNode } from "react";
import type { Arrow } from "react-chessboard";
import { evalText, type Position, type Ranking, type Reference, type Shown } from "./messages";

const TOP_MOVES = 5;
const ARROWS = 3;
const STOCKFISH_COLOR = CHART_STATUS_COLORS.positive;
const SYSTEM_ONE_COLOR = getCategoricalLineChartColor(0);

interface Props {
  shown: Shown | null;
  /** Inside LangSmith's iframe rather than opened on its own. */
  embedded: boolean;
}

export function Render({ shown, embedded }: Props) {
  if (!shown) {
    return (
      <main className="p-space-3">
        <Text variant="sm" color="tertiary">
          {embedded
            ? "Waiting for LangSmith to send a run…"
            : "This page draws the positions dataset inside LangSmith. Set its URL as the " +
              "dataset's custom output renderer with `lcchess-evals positions upload " +
              "--renderer-url`."}
        </Text>
      </main>
    );
  }
  switch (shown.kind) {
    case "unreadable":
      return (
        <main className="p-space-3">
          <Banner intent="warning" title="Not a chess position">
            {shown.reason}
          </Banner>
        </main>
      );
    case "reference":
      return <ReferenceView position={shown.position} reference={shown.reference} />;
    case "output":
      return <OutputView position={shown.position} ranking={shown.ranking} />;
  }
}

/** The top moves as arrows, the first strongest and drawn last so it lies on top. */
function useArrows(ucis: readonly string[], color: string): Arrow[] {
  const resolve = useChartColorResolver();
  return ucis
    .slice(0, ARROWS)
    .map((uci, i) => ({
      startSquare: uci.slice(0, 2),
      endSquare: uci.slice(2, 4),
      color: resolve(i === 0 ? color : `color-mix(in srgb, ${color} 60%, transparent)`),
    }))
    .reverse();
}

function Layout({
  title,
  position,
  arrows,
  children,
}: {
  title: string;
  position: Position;
  arrows: Arrow[];
  children: ReactNode;
}) {
  const mover = position.mover === "white" ? "White" : "Black";
  return (
    <main className="grid items-start gap-space-4 p-space-3 sm:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <div className="w-full max-w-[360px]">
        <Board
          fen={position.fen}
          orientation={position.mover}
          humanSide={position.mover}
          lastMove={position.lastMove}
          locked
          arrows={arrows}
        />
      </div>
      <section className="flex min-w-0 flex-col gap-space-3" aria-label={title}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-space-2">
          <Text variant="h4" as="h2">
            {title}
          </Text>
          <Text variant="sm" color="tertiary" as="span">
            {mover} to move · move {fullmoveNumber(position.fen)}
          </Text>
        </div>
        {children}
      </section>
    </main>
  );
}

function ReferenceView({ position, reference }: { position: Position; reference: Reference }) {
  const arrows = useArrows(reference.ranked, STOCKFISH_COLOR);
  const best = reference.ranked[0];
  return (
    <Layout title="Stockfish" position={position} arrows={arrows}>
      <Facts>
        <Fact
          label="Best"
          value={`${sanAt(position.fen, best)} ${evalText(reference.evals[best], position.mover)}`}
        />
      </Facts>
      <table className="w-full text-sm" aria-label="engine evals">
        <thead>
          <tr className="text-left text-tertiary">
            <th className="w-[4ch] font-normal">#</th>
            <th className="font-normal">Move</th>
            <th className="text-right font-normal">Eval</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {reference.ranked.map((uci, i) => (
            <tr key={uci} className={i < ARROWS ? "font-semibold text-primary" : "text-secondary"}>
              <td>{i + 1}</td>
              <td>{sanAt(position.fen, uci)}</td>
              <td className="text-right">{evalText(reference.evals[uci], position.mover)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  );
}

function OutputView({ position, ranking }: { position: Position; ranking: Ranking }) {
  const [all, setAll] = useState(false);
  const picks = ranking.kind === "ranked" ? ranking.moves : [];
  const arrows = useArrows(
    picks.map((m) => m.uci),
    SYSTEM_ONE_COLOR,
  );
  const cost = (
    <>
      {ranking.requests !== null && <Fact label="Requests" value={String(ranking.requests)} />}
      {ranking.latencyMs !== null && <Fact label="Latency" value={seconds(ranking.latencyMs)} />}
    </>
  );
  if (ranking.kind === "failed") {
    return (
      <Layout title="System 1" position={position} arrows={arrows}>
        <Banner intent="error" title="Ranking failed">
          {ranking.error}
        </Banner>
        <Facts>{cost}</Facts>
      </Layout>
    );
  }
  const shown = all ? picks : picks.slice(0, TOP_MOVES);
  return (
    <Layout title="System 1" position={position} arrows={arrows}>
      <div className="flex flex-col gap-space-2" aria-label="system 1 moves">
        {shown.map((move) => (
          <MoveBar key={move.uci} move={move} fen={position.fen} />
        ))}
      </div>
      {picks.length > TOP_MOVES && (
        <Button
          variant="plain"
          color="secondary"
          size="sm"
          className="self-start"
          onClick={() => setAll((a) => !a)}
        >
          {all ? "Show fewer" : `Show all ${picks.length}`}
        </Button>
      )}
      <Facts>
        <Fact label="Confidence" value={percent(ranking.confidence)} />
        <Fact label="Margin" value={percent(ranking.margin)} />
        <Fact
          label="Tournament"
          value={
            ranking.tournament ? `${picks.length} of ${position.legal.length} in the final` : "no"
          }
        />
        {cost}
      </Facts>
    </Layout>
  );
}

function Facts({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[auto_1fr] gap-x-space-4 gap-y-space-1">{children}</dl>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-sm text-secondary">{label}</dt>
      <dd className="font-mono text-sm text-primary">{value}</dd>
    </>
  );
}
