import { Banner } from "@langchain/macaw-components/Banner";
import { Button } from "@langchain/macaw-components/Button";
import { Card } from "@langchain/macaw-components/Card";
import { ErrorMessage } from "@langchain/macaw-components/ErrorMessage";
import { IconButton } from "@langchain/macaw-components/IconButton";
import { Logo } from "@langchain/macaw-components/Logo";
import { Text } from "@langchain/macaw-components/Text";
import { ThinkingState } from "@langchain/macaw-components/ThinkingState";
import { GearSixIcon } from "@phosphor-icons/react/dist/ssr/GearSix";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Board,
  BoardControls,
  MoveList,
  opposite,
  PlyDetails,
  sideToMove,
  START_FEN,
  type ChessContext,
  type PlyView,
  type Side,
  usePlyCursor,
} from "@langchain-chess/chess-ui";
import { checkApiKey, type KeyCheck } from "./auth";
import { downloadJson } from "./files";
import { fetchModelLimit, type ModelLimit } from "./modelLimit";
import { AppSettingsDialog } from "./components/AppSettingsDialog";
import { GameClock } from "./components/GameClock";
import { NewGameDialog } from "./components/NewGameDialog";
import { ResultCard } from "./components/ResultCard";
import { ThemeToggle } from "./components/ThemeToggle";
import { describeError, isAuthError, isBusyRejection, statusLine } from "./format";
import { apiUrl, configurableOf } from "./settings";
import { flaggedSide } from "./clock";
import { changedKnobs, opponentLabel, resolveSide, type GameRecord, type Setup } from "./setup";
import {
  browserStorage,
  loadAppSettings,
  loadPlyView,
  loadSetup,
  saveAppSettings,
  savePlyView,
  saveSetup,
  type AppSettings,
} from "./storage";
import { monotonic, useFlag, type Now } from "./useClock";
import { threadFromUrl, useGame, writeThreadToUrl } from "./useGame";

/** One game on screen. */
interface Seat {
  /** Changes on every new game, remounting the table so useStream starts a fresh thread. */
  number: number;
  /** A fresh game where the opponent opens: the table sends `go` once, on mount. */
  autoStart: boolean;
  /** A new game's picks, until its first turn records them; null from a link. */
  chosen: GameRecord | null;
}

/** Settings opened from New game go back to it; `draft` holds the picks not yet played. */
type Overlay =
  | { kind: "new-game"; draft: Setup | null }
  | { kind: "settings"; back: Overlay }
  | null;

const NEW_GAME: Overlay = { kind: "new-game", draft: null };

function nextSeat(previous: Seat | null, chosen: GameRecord): Seat {
  return { number: (previous?.number ?? 0) + 1, chosen, autoStart: chosen.side === "black" };
}

interface Props {
  /** Resolves a Random side; injectable so tests are deterministic. */
  random?: () => number;
  /** Asks the server about a key before a game starts; injectable so tests need no server. */
  checkKey?: (apiKey: string) => Promise<KeyCheck>;
  /** Asks the server for a model's input limit; injectable so tests need no server. */
  modelLimit?: (apiKey: string, model: string) => Promise<ModelLimit>;
  /** The clocks' time source; injectable so tests control it. */
  now?: Now;
}

const serverCheck = (apiKey: string) => checkApiKey(apiUrl(), apiKey);
const serverLimit = (apiKey: string, model: string) => fetchModelLimit(apiUrl(), apiKey, model);

export default function App({
  random = Math.random,
  checkKey = serverCheck,
  modelLimit = serverLimit,
  now = monotonic,
}: Props) {
  const [app, setApp] = useState<AppSettings>(() => loadAppSettings());
  const [setup, setSetup] = useState<Setup>(() => loadSetup());
  const [view, setView] = useState<PlyView>(() => loadPlyView());
  const [seat, setSeat] = useState<Seat | null>(() => {
    const threadId = threadFromUrl();
    return threadId ? { number: 0, autoStart: false, chosen: null } : null;
  });
  const [overlay, setOverlay] = useState<Overlay>(() => (seat ? null : NEW_GAME));
  const [unsaved, setUnsaved] = useState(() => browserStorage() === null);
  const noteSaved = useCallback((saved: boolean) => {
    if (!saved) setUnsaved(true);
  }, []);

  // With no game on screen the New game dialog is the page: it can't be closed, and the header's
  // Settings is out of reach behind it, so a null `back` always means the game on screen.
  const closeNewGame = useCallback(() => setOverlay(null), []);
  const settingsBack = overlay?.kind === "settings" ? overlay.back : null;
  const closeSettings = useCallback(() => setOverlay(settingsBack), [settingsBack]);
  const openNewGame = useCallback(() => setOverlay(NEW_GAME), []);
  const openSettings = useCallback(() => setOverlay({ kind: "settings", back: null }), []);
  const openSettingsFromNewGame = useCallback(
    (draft: Setup) => setOverlay({ kind: "settings", back: { kind: "new-game", draft } }),
    [],
  );

  // Stable per key: the dialog asks again whenever this changes.
  const limitFor = useCallback(
    (model: string) => modelLimit(app.apiKey, model),
    [modelLimit, app.apiKey],
  );

  const onSaveApp = useCallback(
    (next: AppSettings) => {
      noteSaved(saveAppSettings(next));
      setApp(next);
      closeSettings();
    },
    [closeSettings, noteSaved],
  );

  const onViewChange = useCallback(
    (next: PlyView) => {
      noteSaved(savePlyView(next));
      setView(next);
    },
    [noteSaved],
  );

  const play = useCallback(
    (next: Setup, context: ChessContext) => {
      noteSaved(saveSetup(next));
      setSetup(next);
      writeThreadToUrl(null);
      const side = resolveSide(next.side, random);
      setSeat((s) => nextSeat(s, { side, context, timeControl: next.timeControl }));
      setOverlay(null);
    },
    [random, noteSaved],
  );

  const rematch = useCallback((from: GameRecord) => {
    writeThreadToUrl(null);
    setSeat((s) => nextSeat(s, { ...from, side: opposite(from.side) }));
  }, []);

  // The same thread, on a fresh stream: the URL still names it.
  const reload = useCallback(
    (from: Seat) => setSeat({ ...from, number: from.number + 1, autoStart: false }),
    [],
  );

  return (
    <div className="min-h-screen bg-surface-level-1 text-primary">
      <div className="mx-auto flex max-w-6xl flex-col gap-space-5 px-space-5 pb-space-8 pt-space-5">
        <header className="flex flex-wrap items-center justify-between gap-space-4">
          <div className="flex items-center gap-space-3">
            <Logo brand="langchain" variant="logomark" size="sm" />
            <Text variant="h2" as="h1">
              LangChain Chess
            </Text>
          </div>
          <div className="flex items-center gap-space-2">
            <Button color="primary" size="md" onClick={openNewGame}>
              New game
            </Button>
            <IconButton
              variant="outlined"
              color="secondary"
              size="md"
              icon={GearSixIcon}
              label="Settings"
              onClick={openSettings}
            />
            <ThemeToggle />
          </div>
        </header>

        {unsaved && (
          <Banner intent="warning" title="This browser isn't saving">
            Its storage is blocked or full, so your key, last setup and view won't be remembered
            here.
          </Banner>
        )}

        {seat ? (
          <Table
            key={seat.number}
            apiKey={app.apiKey}
            seat={seat}
            onRematch={rematch}
            onReload={reload}
            onNewGame={openNewGame}
            onOpenSettings={openSettings}
            view={view}
            onViewChange={onViewChange}
            now={now}
          />
        ) : (
          <EmptyTable view={view} onViewChange={onViewChange} />
        )}
      </div>

      {overlay?.kind === "new-game" && (
        <NewGameDialog
          initial={overlay.draft ?? setup}
          canCancel={seat !== null}
          onPlay={play}
          onClose={closeNewGame}
          onOpenSettings={openSettingsFromNewGame}
          checkKey={() => checkKey(app.apiKey)}
          modelLimit={limitFor}
        />
      )}
      {overlay?.kind === "settings" && (
        <AppSettingsDialog settings={app} onSave={onSaveApp} onClose={closeSettings} />
      )}
    </div>
  );
}

/** The board before the first game, behind the New game dialog. */
function EmptyTable({ view, onViewChange }: ViewProps) {
  return (
    <main className="grid items-start gap-space-5 lg:grid-cols-[minmax(320px,640px)_minmax(280px,1fr)]">
      <Card intent="neutral" className="flex flex-col gap-space-3">
        <Board fen={START_FEN} orientation="white" humanSide="white" lastMove={null} locked />
        <Text variant="body" color="secondary">
          Choose a side and an opponent to start.
        </Text>
      </Card>
      <aside className="flex flex-col gap-space-4">
        <PlyDetails reply={{ status: "none" }} view={view} onViewChange={onViewChange} />
        <MoveList entries={[]} startFen={START_FEN} />
      </aside>
    </main>
  );
}

interface ViewProps {
  view: PlyView;
  onViewChange: (view: PlyView) => void;
}

interface TableProps extends ViewProps {
  apiKey: string;
  seat: Seat;
  onRematch: (from: GameRecord) => void;
  onReload: (from: Seat) => void;
  onNewGame: () => void;
  onOpenSettings: () => void;
  now: Now;
}

function Table({
  apiKey,
  seat,
  onRematch,
  onReload,
  onNewGame,
  onOpenSettings,
  view,
  onViewChange,
  now,
}: TableProps) {
  const game = useGame(apiKey, seat.chosen, now);
  const { record } = game;
  // A stand-in for a thread with no record: its board stays locked.
  const humanSide = record?.side ?? "white";
  const [dismissed, setDismissed] = useState<string | null>(null);
  // Run failures arrive on the stream; this holds a submit that failed before it got there.
  const [submitError, setSubmitError] = useState<unknown>(null);
  const autoStarted = useRef(false);

  const over = game.outcome !== null;
  const opponentToMove = sideToMove(game.fen) !== humanSide;
  const playable = record !== null && game.restore === "ready";
  const idle = playable && !game.isLoading && game.pendingMove === null;
  // A pending turn means a run failed mid-turn: only an empty submit resumes it.
  const canRetry = !over && idle && (game.pendingTurn || game.fallen !== null);
  const canGo = !over && idle && !game.pendingTurn && opponentToMove;
  // Follows the side, which a game opened from its link only knows once its thread loads.
  const [flipped, setFlipped] = useState(false);
  const orientation = flipped ? opposite(humanSide) : humanSide;
  const last = game.moves.length;
  const { index, live, go } = usePlyCursor(last);
  const boardFen = live ? (game.pendingMove?.fen ?? game.fen) : game.fens[index];
  const lastMove = live
    ? (game.pendingMove?.uci ?? game.moves.at(-1) ?? null)
    : (game.moves[index - 1] ?? null);
  const notice = game.error && game.error !== dismissed ? game.error : null;
  const failure = submitError ?? game.streamError;
  const failureText = describeError(failure);
  const changed = record ? changedKnobs(record.context) : [];

  // Every new command re-arms the notice, so a repeated rejection shows again.
  const issue = (run: () => Promise<void>) => {
    setDismissed(null);
    setSubmitError(null);
    run().catch((error: unknown) => {
      // A second command while one is in flight is dropped: the first one's answer is coming.
      if (!isBusyRejection(error)) setSubmitError(error);
    });
  };

  useFlag(game.flaggable, now, (side) => issue(() => game.flag(side)));
  const outOfTime = flaggedSide(game.outcome, sideToMove(game.fen));
  const clockOf = (side: Side) =>
    game.clock && (
      <GameClock
        clock={game.clock}
        side={side}
        label={side === humanSide ? "You" : "Opponent"}
        now={now}
        flagged={side === outOfTime}
      />
    );

  // The ref, not the deps, makes this once per game: StrictMode re-runs mount effects.
  useEffect(() => {
    if (!seat.autoStart || autoStarted.current) return;
    autoStarted.current = true;
    issue(game.start);
  });

  return (
    <>
      {game.restore === "failed" && (
        <Banner
          intent="error"
          title="Couldn't load this game"
          action={
            <Button variant="plain" size="sm" color="primary" onClick={() => onReload(seat)}>
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
            <Button variant="plain" size="sm" color="primary" onClick={onOpenSettings}>
              Open settings
            </Button>
          }
        >
          The server refused the request. Add or check your API key in Settings.
        </Banner>
      )}
      <main className="grid items-start gap-space-5 lg:grid-cols-[minmax(320px,640px)_minmax(280px,1fr)]">
        <Card intent="neutral" className="flex flex-col gap-space-3">
          {clockOf(opposite(orientation))}
          <Board
            fen={boardFen}
            orientation={orientation}
            humanSide={humanSide}
            lastMove={lastMove}
            locked={
              !playable ||
              !live ||
              game.isLoading ||
              over ||
              game.pendingTurn ||
              game.fallen !== null ||
              game.pendingMove !== null
            }
            onMove={(uci, fen) => issue(() => game.play(uci, fen))}
          />
          {clockOf(orientation)}
          <BoardControls index={index} last={last} onGo={go} onFlip={() => setFlipped((f) => !f)} />
          {game.outcome && record ? (
            <ResultCard
              outcome={game.outcome}
              humanSide={record.side}
              onRematch={() => onRematch(record)}
              onNewGame={onNewGame}
            />
          ) : (
            <div className="flex min-h-8 items-center justify-between gap-space-3">
              {game.isThinking ? (
                <ThinkingState label="Opponent is thinking" tone="brand" size="sm" showElapsed />
              ) : (
                <Text variant="body" color="secondary">
                  {statusLine({
                    outcome: game.outcome,
                    fen: game.fen,
                    moveCount: game.moves.length,
                    humanSide: record?.side ?? null,
                    pending: game.pendingTurn,
                  })}
                </Text>
              )}
              {canGo && (
                <Button color="primary" size="md" onClick={() => issue(game.start)}>
                  {game.moves.length === 0 ? "Start" : "Ask opponent to move"}
                </Button>
              )}
              {canRetry && (
                <Button
                  variant="outlined"
                  color="secondary"
                  size="md"
                  onClick={() => issue(game.retry)}
                >
                  Retry
                </Button>
              )}
            </div>
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
        </Card>
        <aside className="flex flex-col gap-space-4">
          <PlyDetails
            reply={game.reply}
            view={view}
            onViewChange={onViewChange}
            timed={game.clock !== null}
          />
          <MoveList
            entries={game.entries}
            startFen={game.startFen}
            selected={index - 1}
            onSelect={(ply) => go(ply + 1)}
          />
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
              <Text variant="xs" color="tertiary">
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
                    onClick={() => onRematch(record)}
                  >
                    Rematch
                  </Button>
                )}
                <Button
                  variant="plain"
                  color="secondary"
                  size="sm"
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
        </aside>
      </main>
    </>
  );
}
