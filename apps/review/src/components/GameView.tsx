import { Button } from "@langchain/macaw-components/Button";
import { Card } from "@langchain/macaw-components/Card";
import { TabGroup, TabLabel, TabList, TabPanel, TabPanels } from "@langchain/macaw-components/Tabs";
import { Text } from "@langchain/macaw-components/Text";
import { cn } from "@langchain/macaw-components/utils/cn";
import {
  CHART_STATUS_COLORS,
  useChartColorResolver,
} from "@langchain/macaw-components/utils/chartColors";
import {
  allocate,
  BackToLive,
  Board,
  BoardControls,
  BoardMenu,
  copyText,
  DisplayMenu,
  ExportMenu,
  lichessUrl,
  EVAL_BAR,
  moveLabel,
  sanAt,
  fenOrStart,
  GameShell,
  MoveList,
  OpeningHeading,
  OpeningMark,
  openingAt,
  opposite,
  PlayerStrip,
  PlyDetails,
  replay,
  ShortcutDialog,
  stripResult,
  TOUCH_TARGET,
  toPgn,
  turnOf,
  useGameKeys,
  useCoarsePointer,
  withAlpha,
  usePlyCursor,
  type Layout,
  type Space,
  type ChessValues,
  type DisplayPrefs,
  type MoveEntry,
  type OpeningTable,
  type Ply,
  type PlyView,
  type Side,
} from "@langchain-chess/chess-ui";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr/ArrowSquareOut";
import { useCallback, useMemo, useState } from "react";
import type { Analysis, LaunchState } from "../analysis";
import type { TraceTarget } from "../api";
import type { OpenUrl } from "../App";
import { reviewPgn } from "../export";
import { recordsByPly } from "../values";
import { sideLabel, type Game } from "../games";
import { evalText } from "../review";
import {
  flawNote,
  NOTE_CLASSES,
  previewFens,
  REVIEW_TABS,
  type Preview,
  type ReviewTab,
} from "../tools";
import { usePreviewKeys } from "../usePreviewKeys";
import { AnalysisBanner } from "./AnalysisBanner";
import { EngineHeader } from "./EngineHeader";
import { EngineLines, type LinePick } from "./EngineLines";
import { EvalBar } from "./EvalBar";
import { EvalGraph } from "./EvalGraph";
import { ExportPanel } from "./ExportPanel";
import { LatencyChart } from "./LatencyChart";
import { PreviewBar } from "./PreviewBar";
import { Summary } from "./Summary";

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
  prefs: DisplayPrefs;
  onPrefsChange: (prefs: DisplayPrefs) => void;
  openings: OpeningTable | null;
  openUrl: OpenUrl;
  /** The tab under the board: the App keeps it from game to game. */
  tab: ReviewTab;
  onTabChange: (tab: ReviewTab) => void;
}

const NO_MOVES: string[] = [];
const NO_PLIES: Ply[] = [];
const BRAND = "var(--bg-brand)";
const MOVE_ID = "move-";

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
  prefs,
  onPrefsChange,
  openings,
  openUrl,
  tab,
  onTabChange,
}: Props) {
  const startFen = fenOrStart(values.start_fen);
  const moves = values.moves ?? NO_MOVES;
  const plies = values.plies ?? NO_PLIES;
  const grading = game.grading;
  const review = grading.status === "graded" ? grading.review : null;
  const last = moves.length;
  const cursor = usePlyCursor(last);
  const index = cursor.index;
  const [pinned, setPinned] = useState<Preview | null>(null);
  const [hovered, setHovered] = useState<Preview | null>(null);
  const leave = useCallback(() => {
    setPinned(null);
    setHovered(null);
  }, []);
  // Every cursor change goes through here, and leaves the preview.
  const go = useCallback(
    (to: number) => {
      leave();
      cursor.go(to);
    },
    [cursor, leave],
  );
  const pin = pinned?.from === index ? pinned : null;
  const shown = pin ?? (hovered?.from === index ? hovered : null);
  const step = useCallback((at: number) => setPinned((p) => p && { ...p, at }), []);
  const [orientation, setOrientation] = useState<Side>("white");
  const flip = useCallback(() => setOrientation((o) => opposite(o)), []);
  const [help, setHelp] = useState(false);
  const openHelp = useCallback(() => setHelp(true), []);
  useGameKeys({ index, last, onGo: go, onFlip: flip, onHelp: openHelp, enabled: !pin });
  usePreviewKeys({
    at: pin?.at ?? null,
    last: pin ? pin.line.fens.length - 1 : 0,
    onStep: step,
    onLeave: leave,
  });
  const resolve = useChartColorResolver();
  const coarse = useCoarsePointer();
  const allocation = allocate({
    layout,
    ...space,
    left: null,
    evalBar: review ? EVAL_BAR.wide : 0,
    coarse,
    scale: prefs.boardScale,
  });

  const replayed = useMemo(() => replay(startFen, moves), [startFen, moves]);
  const fens = replayed.fens;
  const records = useMemo(() => recordsByPly(plies, moves.length), [plies, moves.length]);
  // From the lines graded, not `settings.multipv`: a setting the feedback claims can be any size.
  const lineCount = useMemo(
    () => review?.plies.reduce((most, p) => Math.max(most, p.lines.length), 0) ?? 0,
    [review],
  );
  const openPreview = (pick: LinePick) => {
    setHovered(null);
    setPinned({ ...pick, from: index });
  };
  const hoverPreview = coarse
    ? undefined
    : (pick: LinePick | null) => setHovered(pick && { ...pick, from: index });
  // A System 1 move, from the position the ply was chosen in.
  const movePick = (uci: string): LinePick => ({
    id: `${MOVE_ID}${uci}`,
    line: previewFens(fens[index - 1], [uci]),
    at: 0,
  });
  const boardFen = shown ? shown.line.fens[shown.at] : fens[index];
  const entries: MoveEntry[] = moves.map((uci, i) => ({
    ply: i,
    san: records[i]?.san ?? replayed.sans[i] ?? uci,
    source: records[i]?.source ?? "external",
    quality: review?.plies[i]?.quality,
  }));

  const opening = useMemo(
    () => (openings ? openingAt(fens, index, openings) : null),
    [openings, fens, index],
  );
  const [exportNote, setExportNote] = useState<string | null>(null);
  // The whole game, so once per game, not per move: the Export tab shows it on every render.
  const pgnText = useMemo(() => {
    const latest = openings ? openingAt(fens, last, openings) : null;
    const { game: pgnGame, meta } = reviewPgn(game, values, review, latest);
    return toPgn(pgnGame, meta);
  }, [openings, fens, last, game, values, review]);
  const pgn = () => pgnText;
  const copy = async (what: string, text: string) => {
    if (await copyText(text)) {
      setExportNote(`Copied the ${what}.`);
      return;
    }
    setExportNote(`The browser didn't allow copying. Select the ${what} in the Export tab.`);
    onTabChange("export");
  };
  const analyze = () => {
    const link = lichessUrl(pgn(), fens[index]);
    openUrl(link.url, { newTab: true });
    setExportNote(link.fallback ? "Opened the position; the game was too long to send." : null);
  };

  const ply = index > 0 ? records[index - 1] : undefined;
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
  // The move just played, on the board after it, as Lichess draws it (ui/analyse/src/autoShape.ts).
  if (played && !shown) {
    const bad = grade?.quality === "mistake" || grade?.quality === "blunder";
    arrows.push({
      startSquare: played.slice(0, 2),
      endSquare: played.slice(2, 4),
      color: withAlpha(resolve(bad ? CHART_STATUS_COLORS.negative : BRAND), 0.5),
    });
  }
  if (!shown && grade?.best_move && grade.best_move !== played) {
    arrows.push({
      startSquare: grade.best_move.slice(0, 2),
      endSquare: grade.best_move.slice(2, 4),
      color: withAlpha(resolve(CHART_STATUS_COLORS.positive), 0.5),
    });
  }

  const strip = (side: Side) => {
    const accuracy = review?.accuracy[side];
    return (
      <PlayerStrip
        side={side}
        name={sideLabel(game, plies, side)}
        fen={boardFen}
        showMaterial={prefs.showMaterial}
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
      {review && <EngineHeader review={review} index={index} grade={grade} san={ply?.san} />}
      {review && grade && (
        <EngineLines
          title={`Before ${moveLabel(startFen, index - 1, ply?.san ?? sanAt(fens[index - 1], grade.uci))}`}
          base={fens[index - 1]}
          lines={grade.lines}
          rows={lineCount}
          pinned={pin}
          onPin={openPreview}
          onHover={hoverPreview}
        />
      )}
      <Card intent="neutral" className="flex min-h-96 flex-1 flex-col gap-space-2 p-space-2">
        <MoveList
          entries={entries}
          startFen={startFen}
          selected={index - 1}
          onSelect={(p) => go(p + 1)}
          outcome={values.outcome ?? null}
          drawOffers={values.draw_offers}
          heading={<OpeningHeading opening={opening} />}
          aside={(p) =>
            opening && opening.reachedIndex > 0 && opening.reachedIndex === p + 1 ? (
              <OpeningMark opening={opening} />
            ) : null
          }
          after={(p) => (
            <>
              {review && (
                <span className="ml-auto pl-space-1 text-xs opacity-70" data-eval>
                  {evalText(review.evals[p + 1])}
                </span>
              )}
            </>
          )}
          note={(p) => {
            const flaw = prefs.mistakeNotes ? flawNote(review?.plies[p], fens[p]) : null;
            return (
              flaw && (
                <div
                  aria-label="mistake note"
                  className={cn(
                    "flex flex-wrap gap-x-space-2 px-space-2 py-space-1 font-sans text-xs",
                    NOTE_CLASSES[flaw.quality],
                  )}
                >
                  <span className="font-medium">{flaw.text}</span>
                  <span className="font-mono">{flaw.line}</span>
                </div>
              )
            );
          }}
        />
        {pin && <PreviewBar preview={pin} onStep={step} onLeave={leave} />}
        <BackToLive index={index} last={last} onGo={go} />
        {exportNote && (
          <Text variant="sm" color="secondary" role="status" aria-label="export">
            {exportNote}
          </Text>
        )}
        <BoardControls
          index={index}
          last={last}
          onGo={go}
          menu={
            <BoardMenu onFlip={flip} onHelp={openHelp}>
              <DisplayMenu
                prefs={prefs}
                onChange={onPrefsChange}
                boardSize={layout !== "phone"}
                app="review"
              />
              <ExportMenu
                onCopyFen={() => void copy("FEN", boardFen)}
                onCopyPgn={() => void copy("PGN", pgn())}
                onLichess={analyze}
              />
            </BoardMenu>
          }
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
          preview={{
            onPin: (uci) => openPreview(movePick(uci)),
            onHover: hoverPreview && ((uci) => hoverPreview(uci === null ? null : movePick(uci))),
            pinned: pin?.id.startsWith(MOVE_ID) ? pin.line.moves[0] : null,
          }}
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
      {review && (
        <Summary
          review={review}
          plies={plies}
          names={{ white: sideLabel(game, plies, "white"), black: sideLabel(game, plies, "black") }}
          index={index}
          onGo={go}
        />
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
            fen={boardFen}
            orientation={orientation}
            humanSide={orientation}
            lastMove={shown ? shown.line.moves[shown.at] : played}
            locked
            arrows={arrows}
            prefs={prefs}
            onWheelStep={
              prefs.wheelSteps && !coarse
                ? (step) => go(Math.max(0, Math.min(last, index + step)))
                : undefined
            }
          />
        }
        table={tools}
        under={
          <Card intent="neutral" className="select-none" aria-label="game tabs">
            <TabGroup
              selectedIndex={REVIEW_TABS.indexOf(tab)}
              onChange={(i) => onTabChange(REVIEW_TABS[i])}
            >
              <TabList>
                <TabLabel label="Graph" className={TOUCH_TARGET} />
                <TabLabel label="Agent latency" className={TOUCH_TARGET} />
                <TabLabel label="Export" className={TOUCH_TARGET} />
              </TabList>
              <TabPanels className="pt-space-3">
                <TabPanel>
                  {review ? (
                    <EvalGraph
                      evals={review.evals}
                      grades={review.plies}
                      index={index}
                      onSelect={go}
                    />
                  ) : (
                    <Text variant="sm" color="tertiary">
                      Not graded.
                    </Text>
                  )}
                </TabPanel>
                <TabPanel>
                  <LatencyChart
                    plies={plies}
                    turns={values.turns ?? []}
                    startFen={startFen}
                    index={index}
                    onSelect={go}
                  />
                </TabPanel>
                <TabPanel className="select-text">
                  <ExportPanel
                    fen={boardFen}
                    pgn={pgn()}
                    onCopyFen={() => void copy("FEN", boardFen)}
                    onCopyPgn={() => void copy("PGN", pgn())}
                    onLichess={analyze}
                  />
                </TabPanel>
              </TabPanels>
            </TabGroup>
          </Card>
        }
      />
      {help && <ShortcutDialog onClose={() => setHelp(false)} />}
    </section>
  );
}
