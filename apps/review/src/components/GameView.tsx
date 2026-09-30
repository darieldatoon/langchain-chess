import { Button } from "@langchain/macaw-components/Button";
import { Card } from "@langchain/macaw-components/Card";
import { Text } from "@langchain/macaw-components/Text";
import {
  CHART_STATUS_COLORS,
  getCategoricalLineChartColor,
  useChartColorResolver,
} from "@langchain/macaw-components/utils/chartColors";
import {
  allocate,
  BackToLive,
  Board,
  BoardControls,
  BoardMenu,
  EVAL_BAR,
  fenOrStart,
  GameShell,
  MoveList,
  opposite,
  PlayerStrip,
  PlyDetails,
  replay,
  ShortcutDialog,
  stripResult,
  TOUCH_TARGET,
  turnOf,
  useGameKeys,
  useCoarsePointer,
  usePlyCursor,
  type Layout,
  type Space,
  type ChessValues,
  type MoveEntry,
  type PlyView,
  type Side,
} from "@langchain-chess/chess-ui";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr/ArrowSquareOut";
import { useCallback, useMemo, useState } from "react";
import type { Analysis, LaunchState } from "../analysis";
import type { TraceTarget } from "../api";
import { sideLabel, type Game } from "../games";
import { AnalysisBanner } from "./AnalysisBanner";
import { EvalBar } from "./EvalBar";
import { EvalGraph } from "./EvalGraph";
import { GradeCard } from "./GradeCard";

interface Props {
  game: Game;
  values: ChessValues;
  view: PlyView;
  onViewChange: (view: PlyView) => void;
  onOpenTrace: (target: TraceTarget) => void;
  analysis: Analysis | null;
  launch: LaunchState | undefined;
  onAnalyze: () => void;
  /** Chosen by the App for the whole page; the games column is already taken out of `space`. */
  layout: Layout;
  space: Space;
}

const NO_MOVES: string[] = [];

export function GameView({
  game,
  values,
  view,
  onViewChange,
  onOpenTrace,
  analysis,
  launch,
  onAnalyze,
  layout,
  space,
}: Props) {
  const startFen = fenOrStart(values.start_fen);
  const moves = values.moves ?? NO_MOVES;
  const plies = values.plies ?? [];
  const grading = game.grading;
  const review = grading.status === "graded" ? grading.review : null;
  const last = moves.length;
  const { index, go } = usePlyCursor(last);
  const [orientation, setOrientation] = useState<Side>("white");
  const flip = useCallback(() => setOrientation((o) => opposite(o)), []);
  const [help, setHelp] = useState(false);
  const openHelp = useCallback(() => setHelp(true), []);
  useGameKeys({ index, last, onGo: go, onFlip: flip, onHelp: openHelp });
  const resolve = useChartColorResolver();
  const coarse = useCoarsePointer();
  const allocation = allocate({
    layout,
    ...space,
    left: null,
    evalBar: review ? EVAL_BAR.wide : 0,
    coarse,
    scale: 1,
  });

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
  // The move's run, or the last one; only the last one's start time is loaded.
  const runId = grade?.run_id ?? game.lastRunId;
  const trace: TraceTarget = {
    threadId: game.threadId,
    runId,
    runStartTime: runId === game.lastRunId ? game.lastRunStartTime : null,
  };
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

  const strip = (side: Side) => {
    const accuracy = review?.accuracy[side];
    return (
      <PlayerStrip
        side={side}
        name={sideLabel(game, plies, side)}
        fen={fens[index]}
        showMaterial
        status={
          <>
            {typeof accuracy === "number" && (
              <Text variant="xs" color="secondary" as="span">
                Accuracy {accuracy.toFixed(0)}%
              </Text>
            )}
            {values.outcome && (
              <Text variant="sm" weight="medium" as="span">
                {stripResult(values.outcome, side)}
              </Text>
            )}
          </>
        }
      />
    );
  };

  const tools = (
    <div className="flex h-full min-h-0 flex-col gap-space-3 overflow-y-auto" aria-label="tools">
      <div className="flex flex-wrap items-center justify-end gap-space-2">
        {review && !analysis && (!launch || launch.status === "starting") && (
          <Button
            variant="outlined"
            color="secondary"
            size="sm"
            className={TOUCH_TARGET}
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
          className={TOUCH_TARGET}
          rightDecorator={ArrowSquareOutIcon}
          onClick={() => onOpenTrace(trace)}
        >
          Open trace
        </Button>
      </div>
      <AnalysisBanner
        threadId={game.threadId}
        grading={grading}
        analysis={analysis}
        launch={launch}
        onAnalyze={onAnalyze}
      />
      {review && (
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
      )}
      <Card intent="neutral" className="flex min-h-48 flex-1 flex-col gap-space-2 p-space-2">
        <MoveList
          entries={entries}
          startFen={startFen}
          selected={index - 1}
          onSelect={(p) => go(p + 1)}
          outcome={values.outcome ?? null}
        />
        <BackToLive index={index} last={last} onGo={go} />
        <BoardControls
          index={index}
          last={last}
          onGo={go}
          menu={<BoardMenu onFlip={flip} onHelp={openHelp} />}
        />
      </Card>
      {ply ? (
        <PlyDetails
          title="Who Played It"
          label="who played it"
          reply={{
            status: "played",
            reply: { ply, turn: turnOf(ply, values.turns ?? []), fenBefore: fens[index - 1] },
          }}
          view={view}
          onViewChange={onViewChange}
        />
      ) : (
        <Card intent="neutral" className="flex flex-col gap-space-2" aria-label="who played it">
          <Text variant="h4" as="h2" color="secondary">
            Who Played It
          </Text>
          <Text variant="sm" color="tertiary">
            Start position.
          </Text>
        </Card>
      )}
    </div>
  );

  return (
    <section className="min-w-0" aria-label="game">
      <GameShell
        allocation={allocation}
        topStrip={strip(opposite(orientation))}
        bottomStrip={strip(orientation)}
        evalBar={
          review && <EvalBar value={review.evals[index]} flipped={orientation === "black"} />
        }
        board={
          <Board
            fen={fens[index]}
            orientation={orientation}
            humanSide={orientation}
            lastMove={played}
            locked
            arrows={arrows}
          />
        }
        table={tools}
        under={
          review && (
            <Card intent="neutral" className="select-none" aria-label="evaluation graph">
              <EvalGraph evals={review.evals} index={index} onSelect={go} />
            </Card>
          )
        }
      />
      {help && <ShortcutDialog onClose={() => setHelp(false)} />}
    </section>
  );
}
