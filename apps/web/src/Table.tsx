import { Badge } from "@langchain/macaw-components/Badge";
import { Banner } from "@langchain/macaw-components/Banner";
import { Button } from "@langchain/macaw-components/Button";
import { Card } from "@langchain/macaw-components/Card";
import { ErrorMessage } from "@langchain/macaw-components/ErrorMessage";
import { IconButton } from "@langchain/macaw-components/IconButton";
import { TabGroup, TabLabel, TabList, TabPanel, TabPanels } from "@langchain/macaw-components/Tabs";
import { Text } from "@langchain/macaw-components/Text";
import { ThinkingState } from "@langchain/macaw-components/ThinkingState";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr/ArrowSquareOut";
import { ArrowsDownUpIcon } from "@phosphor-icons/react/dist/ssr/ArrowsDownUp";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BackToLive,
  Board,
  BoardControls,
  BoardMenu,
  copyText,
  DisplayMenu,
  ExportMenu,
  lichessUrl,
  GameShell,
  MoveList,
  MoveStrip,
  OpeningHeading,
  OpeningMark,
  openingAt,
  openingFamily,
  opposite,
  outcomeLine,
  PlayerStrip,
  PlyDetails,
  replyAt,
  scoreText,
  ShortcutDialog,
  sideToMove,
  soFarAt,
  sourceClass,
  sourceLabel,
  START_FEN,
  stripResult,
  TOUCH_TARGET,
  toPgn,
  useCoarsePointer,
  useGameKeys,
  useOpenings,
  usePlyCursor,
  type Allocation,
  type DisplayPrefs,
  type Outcome,
  type Reply,
  type ReplyState,
  type Side,
  type SourceClass,
  type TurnView,
} from "@langchain-chess/chess-ui";
import { downloadJson, downloadText } from "./files";
import { pgnFileName, pgnOf, playerName } from "./export";
import { ExportDialog } from "./components/ExportDialog";
import { GameActions, GameOver, ResultHeadline } from "./components/GameActions";
import { describeError, isAuthError, isBusyRejection } from "./format";
import { configurableOf } from "./settings";
import { changedKnobs, opponentLabel, type GameRecord } from "./setup";
import { pageTitle, useDocumentTitle, useTurnAlert } from "./title";
import { useGame, type Game } from "./useGame";

/** One game on screen. */
export interface Seat {
  /** Changes on every new game, remounting the table so useStream starts a fresh thread. */
  number: number;
  /** A fresh game where the opponent opens: the table sends `go` once, on mount. */
  autoStart: boolean;
  /** A new game's side and context, until its first turn records them; null from a link. */
  chosen: GameRecord | null;
}

export interface ViewProps {
  view: TurnView;
  onViewChange: (view: TurnView) => void;
  prefs: DisplayPrefs;
  onPrefsChange: (prefs: DisplayPrefs) => void;
  allocation: Allocation;
}

interface TableProps extends ViewProps {
  apiKey: string;
  seat: Seat;
  onRematch: (from: GameRecord) => void;
  onReload: (from: Seat) => void;
  onNewGame: () => void;
  /** New game again, with this starting position filled in. */
  onChangePosition: (startFen: string) => void;
  onOpenSettings: () => void;
}

const BADGE_COLORS: Record<SourceClass, "primary" | "special" | "secondary" | "warning" | "plain"> =
  {
    systemone: "primary",
    llm: "special",
    forced: "secondary",
    external: "plain",
    other: "warning",
  };

const REPLY_TAB = 0;

export function Table({
  apiKey,
  seat,
  onRematch,
  onReload,
  onNewGame,
  onChangePosition,
  onOpenSettings,
  view,
  onViewChange,
  prefs,
  onPrefsChange,
  allocation,
}: TableProps) {
  const game = useGame(apiKey, seat.chosen);
  const { record } = game;
  // A stand-in for a thread with no record: its board stays locked.
  const humanSide = record?.side ?? "white";
  const [dismissed, setDismissed] = useState<string | null>(null);
  // Run failures arrive on the stream; this holds a submit that failed before it got there.
  const [submitError, setSubmitError] = useState<unknown>(null);
  const autoStarted = useRef(false);
  const [help, setHelp] = useState(false);
  const [tab, setTab] = useState(REPLY_TAB);

  const over = game.outcome !== null;
  const opponentToMove = sideToMove(game.fen) !== humanSide;
  const playable = record !== null && game.restore === "ready";
  const idle = playable && !game.isLoading && game.pendingMove === null;
  // A pending turn means a run failed mid-turn: only an empty submit resumes it.
  // A first position packet with no answer is resent as it was, before any turn exists.
  const canRetry =
    (!over && idle && game.pendingTurn) || (playable && !over && game.firstUnanswered);
  const canGo = !over && idle && !game.pendingTurn && opponentToMove && !game.firstUnanswered;
  // Follows the side, which a game opened from its link only knows once its thread loads.
  const [flipped, setFlipped] = useState(false);
  const flip = useCallback(() => setFlipped((f) => !f), []);
  const orientation = flipped ? opposite(humanSide) : humanSide;
  const last = game.moves.length;
  const { index, live, go } = usePlyCursor(last);
  const openHelp = useCallback(() => setHelp(true), []);
  useGameKeys({ index, last, onGo: go, onFlip: flip, onHelp: openHelp });
  const coarse = useCoarsePointer();
  const yourMove = playable && !over && !opponentToMove && game.pendingMove === null;
  const alert = useTurnAlert(yourMove, game.restore === "ready" && live);
  const openings = useOpenings(last > 0 || game.startFen !== START_FEN);
  const latestOpening = useMemo(
    () => (openings ? openingAt(game.fens, last, openings) : null),
    [openings, game.fens, last],
  );
  const opening = useMemo(
    () => (openings ? openingAt(game.fens, index, openings) : null),
    [openings, game.fens, index],
  );
  useDocumentTitle(
    pageTitle({
      yourTurn: alert && prefs.tabTitle,
      over,
      opening: latestOpening && openingFamily(latestOpening),
    }),
  );
  const [exported, setExported] = useState<{ title: string; text: string } | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const boardFen = live ? (game.pendingMove?.fen ?? game.fen) : game.fens[index];
  const lastMove = live
    ? (game.pendingMove?.uci ?? game.moves.at(-1) ?? null)
    : (game.moves[index - 1] ?? null);
  // A resent first packet can land after the game ended; that refusal is not the position's fault.
  const stale = over && game.error === "the game is over";
  const notice = game.error && game.error !== dismissed && !stale ? game.error : null;
  const failure = submitError ?? game.streamError;
  const failureText = describeError(failure);

  // Every new command re-arms the notice, so a repeated rejection shows again.
  const issue = (run: () => Promise<void>) => {
    setDismissed(null);
    setSubmitError(null);
    run().catch((error: unknown) => {
      // A second command while one is in flight is dropped: the first one's answer is coming.
      if (!isBusyRejection(error)) setSubmitError(error);
    });
  };

  // The ref, not the deps, makes this once per game: StrictMode re-runs mount effects.
  useEffect(() => {
    if (!seat.autoStart || autoStarted.current) return;
    autoStarted.current = true;
    issue(game.start);
  });

  const reply = live
    ? withError(game.reply, failureText)
    : playedOrNone(replyAt(game.plies, game.turns, game.fens, index, game.policy));
  const soFar = useMemo(
    () => soFarAt(game.turns, game.plies, index, live, game.systemOneLive),
    [game.turns, game.plies, index, live, game.systemOneLive],
  );
  const replyTitle = live ? "Last Reply" : `Reply before move ${index + 1}`;

  const nameOf = (side: Side) => playerName(record, side);
  const statusOf = (side: Side): ReactNode => {
    if (game.outcome) {
      return (
        <Text variant="sm" weight="medium" as="span">
          {stripResult(game.outcome, side)}
        </Text>
      );
    }
    if (!record) return null;
    if (side === record.side) {
      return yourMove && live ? (
        <Text variant="sm" color="secondary" as="span">
          Your turn
        </Text>
      ) : null;
    }
    if (game.isThinking) {
      return <ThinkingState label="Thinking…" tone="brand" size="sm" showElapsed />;
    }
    if (canGo) {
      return (
        <Button
          color="primary"
          size="sm"
          className={TOUCH_TARGET}
          onClick={() => issue(game.start)}
        >
          {game.moves.length === 0 ? "Start" : "Ask opponent to move"}
        </Button>
      );
    }
    if (canRetry) {
      return (
        <Button
          variant="outlined"
          color="secondary"
          size="sm"
          className={TOUCH_TARGET}
          onClick={() => issue(game.retry)}
        >
          Retry
        </Button>
      );
    }
    return null;
  };
  const strip = (side: Side) => (
    <PlayerStrip
      side={side}
      name={nameOf(side)}
      fen={boardFen}
      showMaterial={prefs.showMaterial}
      status={statusOf(side)}
    />
  );

  const phone = allocation.layout === "phone";
  const offers = game.drawOffers.filter((o) => o.ply === last && o.by === humanSide);
  const canResign = playable && !game.isLoading && !over && (last > 0 || game.rootAccepted);
  const canOfferDraw =
    canResign && !opponentToMove && live && !game.pendingTurn && offers.length === 0;
  const actions = (
    <GameActions
      compact={phone}
      canResign={canResign}
      canOfferDraw={canOfferDraw}
      offering={game.sending === "draw"}
      answer={offers.length > 0 ? "Draw declined." : null}
      onResign={() => issue(() => game.resign(humanSide))}
      onOfferDraw={() => issue(() => game.offerDraw(humanSide))}
      onFlip={flip}
    />
  );
  const pgn = () =>
    ((p) => toPgn(p.game, p.meta))(pgnOf(game, latestOpening, window.location.origin));
  const copy = async (title: string, text: string) => {
    if (await copyText(text)) setExportNote(`Copied the ${title}.`);
    else setExported({ title, text });
  };
  const analyze = () => {
    const link = lichessUrl(pgn(), boardFen);
    window.open(link.url, "_blank", "noopener");
    setExportNote(link.fallback ? "Opened the position; the game was too long to send." : null);
  };
  const exportMenu = (
    <ExportMenu
      onCopyFen={() => void copy("FEN", boardFen)}
      onCopyPgn={() => void copy("PGN", pgn())}
      onDownloadPgn={() =>
        downloadText(pgnFileName(game.threadId), pgn(), "application/x-chess-pgn")
      }
      onLichess={analyze}
    />
  );
  const gameOver = over && (
    <GameOver
      humanSide={record?.side ?? null}
      onRematch={() => onRematch(record!)}
      onNewGame={onNewGame}
    >
      <Button
        variant="plain"
        color="secondary"
        size="sm"
        rightDecorator={ArrowSquareOutIcon}
        className={TOUCH_TARGET}
        onClick={analyze}
      >
        Analyze on Lichess
      </Button>
    </GameOver>
  );
  const note = exportNote && (
    <Text variant="sm" color="secondary" role="status" aria-label="export">
      {exportNote}
    </Text>
  );
  const headline = game.outcome && record && (
    <ResultHeadline outcome={game.outcome} humanSide={record.side} />
  );

  const menu = (
    <BoardMenu onFlip={flip} onHelp={openHelp} navigate={phone ? { onGo: go, last } : undefined}>
      <DisplayMenu prefs={prefs} onChange={onPrefsChange} boardSize={!phone} app="web" />
      {exportMenu}
    </BoardMenu>
  );
  // At the root, the heading alone names it.
  const openingMark = (ply: number) =>
    opening && opening.reachedIndex > 0 && opening.reachedIndex === ply + 1 ? (
      <OpeningMark opening={opening} />
    ) : null;

  const replyCard = (
    <PlyDetails
      reply={reply}
      view={view}
      onViewChange={onViewChange}
      soFar={soFar}
      title={replyTitle}
    />
  );
  const opponentCard = <OpponentCard game={game} record={record} onRematch={onRematch} />;

  const shell = (
    <GameShell
      allocation={allocation}
      topStrip={strip(opposite(orientation))}
      bottomStrip={strip(orientation)}
      board={
        <Board
          fen={boardFen}
          orientation={orientation}
          humanSide={humanSide}
          lastMove={lastMove}
          prefs={prefs}
          onWheelStep={
            prefs.wheelSteps && !coarse
              ? (step) => go(Math.max(0, Math.min(last, index + step)))
              : undefined
          }
          locked={
            !playable ||
            !live ||
            game.isLoading ||
            over ||
            game.pendingTurn ||
            game.pendingMove !== null
          }
          onMove={(uci, fen) => issue(() => game.play(uci, fen))}
        />
      }
      left={
        <>
          {replyCard}
          {opponentCard}
        </>
      }
      table={
        phone ? undefined : (
          <Card intent="neutral" className="flex h-full min-h-0 flex-col gap-space-2 p-space-2">
            {headline}
            <MoveList
              entries={game.entries}
              startFen={game.startFen}
              selected={index - 1}
              onSelect={(ply) => go(ply + 1)}
              outcome={game.outcome}
              drawOffers={game.drawOffers}
              heading={<OpeningHeading opening={opening} />}
              aside={openingMark}
            />
            <BackToLive index={index} last={last} onGo={go} />
            <BoardControls index={index} last={last} onGo={go} menu={menu} />
            {gameOver || actions}
            {note}
          </Card>
        )
      }
      under={
        allocation.layout === "wide" ? (
          <div className="grid gap-space-4 md:grid-cols-2">
            {replyCard}
            {opponentCard}
          </div>
        ) : undefined
      }
      phoneBar={
        <div className="flex flex-col gap-space-1">
          <BackToLive index={index} last={last} onGo={go} />
          <div
            className="flex flex-wrap items-center justify-between gap-space-1"
            aria-label="actions"
          >
            <BoardControls index={index} last={last} onGo={go} compact />
            <div className="flex flex-wrap items-center gap-space-1">
              {over ? (
                <IconButton
                  icon={ArrowsDownUpIcon}
                  label="Flip board"
                  size="md"
                  variant="outlined"
                  color="secondary"
                  className={TOUCH_TARGET}
                  onClick={flip}
                />
              ) : (
                actions
              )}
              {menu}
            </div>
          </div>
        </div>
      }
      phoneMoves={
        <>
          <MoveStrip
            entries={game.entries}
            startFen={game.startFen}
            selected={index - 1}
            onSelect={(ply) => go(ply + 1)}
            drawOffers={game.drawOffers}
            aside={openingMark}
          />
          {game.outcome && <ResultLine outcome={game.outcome} />}
        </>
      }
      phoneReply={
        <>
          <OpeningHeading opening={opening} />
          {headline}
          {gameOver}
          {note}
          <ReplyLine
            reply={reply}
            onShow={() => {
              if (!view.show.analysis || !view.open.llm) {
                onViewChange({
                  open: { ...view.open, llm: true },
                  show: { ...view.show, analysis: true },
                });
              }
              setTab(REPLY_TAB);
            }}
          />
        </>
      }
      phoneTabs={
        <TabGroup selectedIndex={tab} onChange={setTab}>
          <TabList>
            <TabLabel label="Reply" className={TOUCH_TARGET} />
            <TabLabel label="Opponent" className={TOUCH_TARGET} />
          </TabList>
          <TabPanels className="pt-space-3">
            <TabPanel>{replyCard}</TabPanel>
            <TabPanel>{opponentCard}</TabPanel>
          </TabPanels>
        </TabGroup>
      }
    />
  );

  return (
    <>
      {game.restore === "failed" && (
        <Banner
          intent="error"
          title="Couldn't load this game"
          action={
            <Button
              variant="plain"
              size="sm"
              color="primary"
              className={TOUCH_TARGET}
              onClick={() => onReload(seat)}
            >
              Reload
            </Button>
          }
        >
          The board stays locked until the game loads.
        </Banner>
      )}
      {game.restore === "missing" && (
        <Banner intent="warning" title="This game isn't on the server">
          The server has no thread by this id, so there is nothing to continue. Start a new game.
        </Banner>
      )}
      {record === null && game.restore === "ready" && (
        <Banner intent="info" title="View only">
          This app can't read which opponent this game was set up with (older games didn't record
          it, or recorded it in an older form), so it can only be shown. Start a new game to play.
        </Banner>
      )}
      {isAuthError(failure) && (
        <Banner
          intent="warning"
          title="LangSmith API key needed"
          action={
            <Button
              variant="plain"
              size="sm"
              color="primary"
              className={TOUCH_TARGET}
              onClick={onOpenSettings}
            >
              Open settings
            </Button>
          }
        >
          The server refused the request. Add or check your API key in Settings.
        </Banner>
      )}
      {notice && (
        <Banner
          key={notice}
          intent="error"
          title="Move rejected"
          dismissible
          onDismiss={() => setDismissed(notice)}
        >
          {notice}
          {game.startRejected && record && (
            <div className="pt-space-2">
              <Button
                variant="outlined"
                color="secondary"
                size="sm"
                className={TOUCH_TARGET}
                onClick={() => onChangePosition(record.startFen)}
              >
                Change position
              </Button>
            </div>
          )}
        </Banner>
      )}
      {failureText && (
        <div role="status">
          <ErrorMessage size="sm" message={failureText} />
        </div>
      )}
      {shell}
      {help && <ShortcutDialog onClose={() => setHelp(false)} />}
      {exported && (
        <ExportDialog
          title={exported.title}
          text={exported.text}
          onClose={() => setExported(null)}
        />
      )}
    </>
  );
}

function playedOrNone(reply: Reply | null): ReplyState {
  return reply ? { status: "played", reply } : { status: "none" };
}

/** A stopped turn shows the error that stopped it, when this page saw one. */
function withError(reply: ReplyState, error: string | null): ReplyState {
  return reply.status === "pending" && reply.activity === "stopped" ? { ...reply, error } : reply;
}

function colourName(side: Side): string {
  return side === "white" ? "White" : "Black";
}

function OpponentCard({
  game,
  record,
  onRematch,
}: {
  game: Game;
  record: GameRecord | null;
  onRematch: (from: GameRecord) => void;
}) {
  const changed = record ? changedKnobs(record.context) : [];
  return (
    <Card intent="neutral" className="flex flex-col gap-space-2" aria-label="opponent">
      <Text variant="h4" as="h2" color="secondary">
        Opponent
      </Text>
      <Text variant="sm" weight="medium">
        {record ? opponentLabel(record.context) : "Unknown"}
      </Text>
      {changed.length > 0 && (
        <Text variant="xs" color="tertiary" className="font-mono">
          {changed.join(" · ")}
        </Text>
      )}
      {game.threadId && (
        <Text variant="xs" color="tertiary" className="break-all">
          Thread <span className="font-mono">{game.threadId}</span>
        </Text>
      )}
      {record ? (
        <div className="flex gap-space-2">
          {/* After the game, the result card offers it. */}
          {!game.outcome && (
            <Button
              variant="outlined"
              color="secondary"
              size="sm"
              className={TOUCH_TARGET}
              onClick={() => onRematch(record)}
            >
              Rematch
            </Button>
          )}
          <Button
            variant="plain"
            color="secondary"
            size="sm"
            className={TOUCH_TARGET}
            onClick={() => downloadJson("opponent.json", configurableOf(record.context))}
          >
            Export
          </Button>
        </div>
      ) : (
        <Text variant="xs" color="tertiary">
          This app can't read this game's settings: start a new game to pick an opponent.
        </Text>
      )}
    </Card>
  );
}

/** The score and how the game ended, under a phone's move strip. */
function ResultLine({ outcome }: { outcome: Outcome }) {
  return (
    <div aria-label="result" className="flex flex-wrap items-baseline gap-x-space-2">
      <Text variant="sm" weight="semibold" as="span">
        {scoreText(outcome)}
      </Text>
      <Text variant="sm" color="secondary" as="span">
        {outcomeLine(outcome)}
      </Text>
    </div>
  );
}

/** The reply under the move strip on phones; the full card is in the Reply tab. */
function ReplyLine({ reply, onShow }: { reply: ReplyState; onShow: () => void }) {
  if (reply.status === "pending") {
    return reply.activity === "running" ? (
      <ThinkingState label="Thinking…" tone="brand" size="sm" showElapsed />
    ) : (
      <Text variant="sm" color="secondary">
        Stopped
      </Text>
    );
  }
  if (reply.status !== "played") {
    return (
      <Text variant="sm" color="tertiary">
        No reply yet.
      </Text>
    );
  }
  const { ply } = reply.reply;
  return (
    <div className="flex min-h-11 items-center gap-space-2" aria-label="reply line">
      <Badge color={BADGE_COLORS[sourceClass(ply.source)]} size="sm">
        {sourceLabel(ply.source)}
      </Badge>
      <Text variant="md" weight="semibold" as="span" className="font-mono">
        {ply.san}
      </Text>
      {ply.analysis && (
        <Button
          variant="plain"
          color="secondary"
          size="sm"
          className={TOUCH_TARGET}
          onClick={onShow}
        >
          Show analysis
        </Button>
      )}
    </div>
  );
}

/** The board before the first game, behind the New game dialog. */
export function EmptyTable({ view, onViewChange, prefs, allocation }: ViewProps) {
  const strip = (side: Side) => (
    <PlayerStrip side={side} name={colourName(side)} fen={START_FEN} showMaterial={false} />
  );
  const reply = <PlyDetails reply={{ status: "none" }} view={view} onViewChange={onViewChange} />;
  return (
    <GameShell
      allocation={allocation}
      topStrip={strip("black")}
      bottomStrip={strip("white")}
      board={
        <Board
          fen={START_FEN}
          orientation="white"
          humanSide="white"
          lastMove={null}
          locked
          prefs={prefs}
        />
      }
      left={reply}
      table={
        allocation.layout === "phone" ? undefined : (
          <Card intent="neutral" className="flex h-full min-h-0 flex-col gap-space-2 p-space-2">
            <MoveList entries={[]} startFen={START_FEN} />
            <Text variant="sm" color="secondary">
              Choose a side and an opponent to start.
            </Text>
          </Card>
        )
      }
      phoneMoves={
        <Text variant="sm" color="secondary">
          Choose a side and an opponent to start.
        </Text>
      }
      under={allocation.layout === "full" ? undefined : reply}
    />
  );
}
