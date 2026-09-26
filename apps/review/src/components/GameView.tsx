import { Banner } from "@langchain/macaw-components/Banner";
import { Button } from "@langchain/macaw-components/Button";
import { Card } from "@langchain/macaw-components/Card";
import { Text } from "@langchain/macaw-components/Text";
import {
  CHART_STATUS_COLORS,
  getCategoricalLineChartColor,
  useChartColorResolver,
} from "@langchain/macaw-components/utils/chartColors";
import {
  Board,
  BoardControls,
  fenOrStart,
  MoveList,
  outcomeLine,
  PlyDetails,
  replay,
  turnOf,
  type ChessValues,
  type MoveEntry,
  type Side,
  usePlyKeys,
} from "@langchain-chess/chess-ui";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr/ArrowSquareOut";
import { useCallback, useMemo, useState } from "react";
import type { Game } from "../games";
import { EvalBar } from "./EvalBar";
import { EvalGraph } from "./EvalGraph";
import { GradeCard } from "./GradeCard";

interface Props {
  game: Game;
  values: ChessValues;
  onOpenRun: (runId: string) => void;
}

const NO_MOVES: string[] = [];

export function GameView({ game, values, onOpenRun }: Props) {
  const startFen = fenOrStart(values.start_fen);
  const moves = values.moves ?? NO_MOVES;
  const plies = values.plies ?? [];
  const review = game.review;
  const last = moves.length;
  const [index, setIndex] = useState(last);
  const [orientation, setOrientation] = useState<Side>("white");
  const resolve = useChartColorResolver();

  const fens = useMemo(
    () => [startFen, ...moves.map((_, i) => replay(startFen, moves.slice(0, i + 1)).fen)],
    [startFen, moves],
  );
  const entries: MoveEntry[] = moves.map((uci, i) => ({
    ply: i,
    san: plies[i]?.san ?? uci,
    source: plies[i]?.source ?? "external",
    quality: review?.plies[i]?.quality,
  }));

  const go = useCallback((next: number) => setIndex(Math.max(0, Math.min(last, next))), [last]);

  usePlyKeys(index, last, go);

  const ply = index > 0 ? plies[index - 1] : undefined;
  const grade = index > 0 ? review?.plies[index - 1] : undefined;
  const played = moves[index - 1] ?? null;
  const arrows = [];
  if (played) {
    arrows.push({
      startSquare: played.slice(0, 2),
      endSquare: played.slice(2, 4),
      color: resolve(getCategoricalLineChartColor(0)),
    });
  }
  if (grade?.best_move && grade.best_move !== played) {
    arrows.push({
      startSquare: grade.best_move.slice(0, 2),
      endSquare: grade.best_move.slice(2, 4),
      color: resolve(CHART_STATUS_COLORS.positive),
    });
  }
  const lineCount = review?.settings.multipv ?? 0;

  return (
    <div
      className="grid min-h-0 items-start gap-space-4 overflow-auto lg:grid-cols-[minmax(320px,560px)_minmax(260px,1fr)]"
      aria-label="game"
    >
      <section className="flex flex-col gap-space-3">
        <Card intent="neutral" className="flex flex-col gap-space-3">
          <div className="flex items-stretch gap-space-2">
            {review && <EvalBar value={review.evals[index]} flipped={orientation === "black"} />}
            <div className="min-w-0 flex-1">
              <Board
                fen={fens[index]}
                orientation={orientation}
                humanSide={orientation}
                lastMove={played}
                locked
                arrows={arrows}
              />
            </div>
          </div>
          <BoardControls
            index={index}
            last={last}
            onGo={go}
            onFlip={() => setOrientation((o) => (o === "white" ? "black" : "white"))}
          >
            <Text variant="sm" color="secondary" className="min-w-0 flex-1 truncate text-center">
              {values.outcome ? outcomeLine(values.outcome) : "In progress"}
            </Text>
            <Button
              variant="outlined"
              color="secondary"
              size="sm"
              rightDecorator={ArrowSquareOutIcon}
              onClick={() => onOpenRun(grade?.run_id ?? game.lastRunId)}
            >
              Open trace
            </Button>
          </BoardControls>
        </Card>
        {review ? (
          <>
            <GradeCard
              move={
                grade && ply
                  ? {
                      grade,
                      san: ply.san,
                      fenBefore: fens[index - 1],
                      before: review.evals[index - 1],
                      after: review.evals[index],
                    }
                  : null
              }
              engine={review.engine}
              lineCount={lineCount}
            />
            <Card intent="neutral" className="select-none" aria-label="evaluation graph">
              <EvalGraph evals={review.evals} index={index} onSelect={go} />
            </Card>
          </>
        ) : (
          <Banner intent="info" title="Not graded yet">
            Grade it with <code>lcchess grade --thread {game.threadId}</code> to see engine
            evaluations here.
          </Banner>
        )}
      </section>

      <aside className="flex flex-col gap-space-3">
        <MoveList
          entries={entries}
          startFen={startFen}
          selected={index - 1}
          onSelect={(p) => go(p + 1)}
        />
        {ply && (
          <PlyDetails
            title="Who Played It"
            reply={{ ply, turn: turnOf(ply, values.turns ?? []), fenBefore: fens[index - 1] }}
          />
        )}
      </aside>
    </div>
  );
}
