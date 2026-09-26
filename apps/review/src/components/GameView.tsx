import { Banner } from "@langchain/macaw-components/Banner";
import { Button } from "@langchain/macaw-components/Button";
import { IconButton } from "@langchain/macaw-components/IconButton";
import { Text } from "@langchain/macaw-components/Text";
import {
  CHART_STATUS_COLORS,
  getCategoricalLineChartColor,
  useChartColorResolver,
} from "@langchain/macaw-components/utils/chartColors";
import {
  Board,
  fenOrStart,
  fullmoveNumber,
  MoveList,
  outcomeLine,
  PlyDetails,
  qualitySymbol,
  replay,
  sideToMove,
  turnOf,
  type ChessValues,
  type MoveEntry,
  type Side,
} from "@langchain-chess/chess-ui";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr/ArrowSquareOut";
import { ArrowsDownUpIcon } from "@phosphor-icons/react/dist/ssr/ArrowsDownUp";
import { CaretDoubleLeftIcon } from "@phosphor-icons/react/dist/ssr/CaretDoubleLeft";
import { CaretDoubleRightIcon } from "@phosphor-icons/react/dist/ssr/CaretDoubleRight";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { useEffect, useMemo, useState } from "react";
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

const STEPS: Record<string, (index: number, last: number) => number> = {
  ArrowLeft: (i) => i - 1,
  ArrowRight: (i) => i + 1,
  Home: () => 0,
  End: (_, last) => last,
};

/** `12.` for White's move and `12…` for Black's, numbered from the game's root. */
function moveNumber(startFen: string, ply: number): string {
  const offset = sideToMove(startFen) === "black" ? 1 : 0;
  const number = fullmoveNumber(startFen) + Math.floor((ply + offset) / 2);
  return (ply + offset) % 2 === 0 ? `${number}.` : `${number}…`;
}

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

  const go = (next: number) => setIndex(Math.max(0, Math.min(last, next)));

  // On the window, not the view: the board's drag layer takes arrow keys from focused squares.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const step = STEPS[event.key];
      if (
        !step ||
        (event.target instanceof Element &&
          event.target.closest("input, textarea, [role=combobox]"))
      )
        return;
      event.preventDefault();
      setIndex((i) => Math.max(0, Math.min(last, step(i, last))));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [last]);

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
  const title = ply ? `${moveNumber(startFen, index - 1)} ${ply.san}` : "Start";

  return (
    <div
      className="grid min-h-0 items-start gap-space-4 overflow-auto lg:grid-cols-[minmax(280px,560px)_minmax(280px,1fr)]"
      aria-label="game"
    >
      <section className="flex flex-col gap-space-3">
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
        <div className="flex items-center justify-between gap-space-2">
          <div className="flex items-center gap-space-1">
            <IconButton
              icon={CaretDoubleLeftIcon}
              label="First move"
              size="sm"
              variant="outlined"
              color="secondary"
              onClick={() => go(0)}
              disabled={index === 0}
            />
            <IconButton
              icon={CaretLeftIcon}
              label="Previous move"
              size="sm"
              variant="outlined"
              color="secondary"
              onClick={() => go(index - 1)}
              disabled={index === 0}
            />
            <IconButton
              icon={CaretRightIcon}
              label="Next move"
              size="sm"
              variant="outlined"
              color="secondary"
              onClick={() => go(index + 1)}
              disabled={index === last}
            />
            <IconButton
              icon={CaretDoubleRightIcon}
              label="Last move"
              size="sm"
              variant="outlined"
              color="secondary"
              onClick={() => go(last)}
              disabled={index === last}
            />
          </div>
          <IconButton
            icon={ArrowsDownUpIcon}
            label="Flip board"
            size="sm"
            variant="plain"
            color="secondary"
            onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))}
          />
        </div>
        {review ? (
          <EvalGraph evals={review.evals} index={index} onSelect={go} />
        ) : (
          <Banner intent="info" title="Not graded yet">
            Grade it with <code>lcchess grade --thread {game.threadId}</code> to see engine
            evaluations here.
          </Banner>
        )}
        <MoveList
          entries={entries}
          startFen={startFen}
          selected={index - 1}
          onSelect={(p) => go(p + 1)}
        />
      </section>

      <section className="flex flex-col gap-space-3">
        <div className="flex items-center justify-between gap-space-2">
          <Text variant="h3" as="h2">
            {title}
            {grade && qualitySymbol(grade.quality)}
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
        </div>
        {values.outcome && index === last && (
          <Text variant="sm" color="secondary">
            {outcomeLine(values.outcome)}
          </Text>
        )}
        {grade && review && ply && (
          <GradeCard
            grade={grade}
            san={ply.san}
            fenBefore={fens[index - 1]}
            before={review.evals[index - 1]}
            after={review.evals[index]}
            engine={review.engine}
          />
        )}
        {ply && (
          <PlyDetails
            title="Who Played It"
            reply={{ ply, turn: turnOf(ply, values.turns ?? []), fenBefore: fens[index - 1] }}
          />
        )}
      </section>
    </div>
  );
}
