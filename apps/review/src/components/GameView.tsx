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
  type PlyView,
  type Side,
  usePlyCursor,
} from "@langchain-chess/chess-ui";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr/ArrowSquareOut";
import { useMemo, useState } from "react";
import type { Analysis, LaunchState } from "../analysis";
import type { Game } from "../games";
import { AnalysisBanner } from "./AnalysisBanner";
import { EvalBar } from "./EvalBar";
import { EvalGraph } from "./EvalGraph";
import { GradeCard } from "./GradeCard";

interface Props {
  game: Game;
  values: ChessValues;
  view: PlyView;
  onViewChange: (view: PlyView) => void;
  onOpenRun: (runId: string) => void;
  analysis: Analysis | null;
  launch: LaunchState | undefined;
  onAnalyze: () => void;
}

const NO_MOVES: string[] = [];

export function GameView({
  game,
  values,
  view,
  onViewChange,
  onOpenRun,
  analysis,
  launch,
  onAnalyze,
}: Props) {
  const startFen = fenOrStart(values.start_fen);
  const moves = values.moves ?? NO_MOVES;
  const plies = values.plies ?? [];
  const grading = game.grading;
  const review = grading.status === "graded" ? grading.review : null;
  const last = moves.length;
  const { index, go } = usePlyCursor(last);
  const [orientation, setOrientation] = useState<Side>("white");
  const resolve = useChartColorResolver();

  const fens = useMemo(() => replay(startFen, moves).fens, [startFen, moves]);
  // From the lines graded, not `settings.multipv`: a setting the feedback claims can be any size.
  const lineCount = useMemo(
    () => review?.plies.reduce((most, p) => Math.max(most, p.lines.length), 0) ?? 0,
    [review],
  );
  const entries: MoveEntry[] = moves.map((uci, i) => ({
    ply: i,
    san: plies[i]?.san ?? uci,
    source: plies[i]?.source ?? "external",
    quality: review?.plies[i]?.quality,
  }));

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
            {review && !analysis && (!launch || launch.status === "starting") && (
              <Button
                variant="outlined"
                color="secondary"
                size="sm"
                loading={launch?.status === "starting"}
                disabled={launch?.status === "starting"}
                onClick={onAnalyze}
              >
                Re-analyze
              </Button>
            )}
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
        <AnalysisBanner
          threadId={game.threadId}
          grading={grading}
          analysis={analysis}
          launch={launch}
          onAnalyze={onAnalyze}
        />
        {review && (
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
            reply={{
              status: "played",
              reply: { ply, turn: turnOf(ply, values.turns ?? []), fenBefore: fens[index - 1] },
            }}
            view={view}
            onViewChange={onViewChange}
            timed={values.time_control != null}
          />
        )}
      </aside>
    </div>
  );
}
