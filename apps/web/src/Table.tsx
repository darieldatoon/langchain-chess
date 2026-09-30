import { Badge } from "@langchain/macaw-components/Badge";
import { Banner } from "@langchain/macaw-components/Banner";
import { Button } from "@langchain/macaw-components/Button";
import { Card } from "@langchain/macaw-components/Card";
import { ErrorMessage } from "@langchain/macaw-components/ErrorMessage";
import { IconButton } from "@langchain/macaw-components/IconButton";
import { TabGroup, TabLabel, TabList, TabPanel, TabPanels } from "@langchain/macaw-components/Tabs";
import { Text } from "@langchain/macaw-components/Text";
import { ThinkingState } from "@langchain/macaw-components/ThinkingState";
import { ArrowsDownUpIcon } from "@phosphor-icons/react/dist/ssr/ArrowsDownUp";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  BackToLive,
  Board,
  BoardControls,
  BoardMenu,
  DisplayMenu,
  GameShell,
  MoveList,
  MoveStrip,
  opposite,
  outcomeLine,
  PlayerStrip,
  PlyDetails,
  replyAt,
  scoreText,
  ShortcutDialog,
  sideToMove,
  sourceClass,
  sourceLabel,
  START_FEN,
  stripResult,
  TOUCH_TARGET,
  useCoarsePointer,
  useGameKeys,
  usePlyCursor,
  type Allocation,
  type DisplayPrefs,
  type Outcome,
  type PlyView,
  type Reply,
  type ReplyState,
  type Side,
  type SourceClass,
} from "@langchain-chess/chess-ui";
import { downloadJson } from "./files";
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
  view: PlyView;
  onViewChange: (view: PlyView) => void;
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
  const canRetry = !over && idle && game.pendingTurn;
  const canGo = !over && idle && !game.pendingTurn && opponentToMove;
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
  useDocumentTitle(pageTitle({ yourTurn: alert && prefs.tabTitle, over }));
  const boardFen = live ? (game.pendingMove?.fen ?? game.fen) : game.fens[index];
  const lastMove = live
    ? (game.pendingMove?.uci ?? game.moves.at(-1) ?? null)
    : (game.moves[index - 1] ?? null);
  const notice = game.error && game.error !== dismissed ? game.error : null;
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

  const reply = live ? game.reply : playedOrNone(replyAt(game.plies, game.turns, game.fens, index));
  const replyTitle = live ? "Last Reply" : `Reply before move ${index + 1}`;

  const nameOf = (side: Side) =>
    record ? (side === record.side ? "You" : opponentLabel(record.context)) : colourName(side);
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
  const menu = (
    <BoardMenu onFlip={flip} onHelp={openHelp} navigate={phone ? { onGo: go, last } : undefined}>
      <DisplayMenu prefs={prefs} onChange={onPrefsChange} boardSize={!phone} app="web" />
    </BoardMenu>
  );
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
  const gameOver = over && (
    <GameOver
      humanSide={record?.side ?? null}
      onRematch={() => onRematch(record!)}
      onNewGame={onNewGame}
    />
  );
  const headline = game.outcome && record && (
    <ResultHeadline outcome={game.outcome} humanSide={record.side} />
  );

  const replyCard = (
    <PlyDetails reply={reply} view={view} onViewChange={onViewChange} title={replyTitle} />
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
            />
            <BackToLive index={index} last={last} onGo={go} />
            <BoardControls index={index} last={last} onGo={go} menu={menu} />
            {gameOver || actions}
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
          />
          {game.outcome && <ResultLine outcome={game.outcome} />}
        </>
      }
      phoneReply={
        <>
          {headline}
          {gameOver}
          <ReplyLine
            reply={reply}
            onShow={() => {
              if (!view.reasoning) onViewChange({ ...view, reasoning: true });
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
        </Banner>
      )}
      {failureText && (
        <div role="status">
          <ErrorMessage size="sm" message={failureText} />
        </div>
      )}
      {shell}
      {help && <ShortcutDialog onClose={() => setHelp(false)} />}
    </>
  );
}

function playedOrNone(reply: Reply | null): ReplyState {
  return reply ? { status: "played", reply } : { status: "none" };
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
  if (reply.status === "thinking") {
    return <ThinkingState label="Thinking…" tone="brand" size="sm" showElapsed />;
  }
  if (reply.status === "none") {
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
          Show reasoning
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
