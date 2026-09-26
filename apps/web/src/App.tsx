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
  replay,
  sideToMove,
  START_FEN,
  type ChessContext,
  type Side,
  usePlyKeys,
} from "@langchain-chess/chess-ui";
import { checkApiKey, type KeyCheck } from "./auth";
import { fetchModelLimit } from "./modelLimit";
import { AppSettingsDialog } from "./components/AppSettingsDialog";
import { NewGameDialog } from "./components/NewGameDialog";
import { ResultCard } from "./components/ResultCard";
import { ThemeToggle } from "./components/ThemeToggle";
import { describeError, isAuthError, isBusyRejection, statusLine } from "./format";
import { apiUrl } from "./settings";
import { changedKnobs, opponentLabel, resolveSide, type GameRecord, type Setup } from "./setup";
import {
  loadAppSettings,
  loadGame,
  loadSetup,
  saveAppSettings,
  saveSetup,
  type AppSettings,
} from "./storage";
import { threadFromUrl, useGame, writeThreadToUrl } from "./useGame";

/** One game on screen: its pinned side and context. */
interface Seat extends GameRecord {
  /** Changes on every new game, remounting the table so useStream starts a fresh thread. */
  number: number;
  /** A fresh game where the opponent opens: the table sends `go` once, on mount. */
  autoStart: boolean;
}

/** Settings opened from New game go back to it; `draft` holds the picks not yet played. */
type Overlay =
  | { kind: "new-game"; draft: Setup | null }
  | { kind: "settings"; back: Overlay }
  | null;

const NEW_GAME: Overlay = { kind: "new-game", draft: null };

function nextSeat(previous: Seat | null, side: Side, context: ChessContext): Seat {
  return { number: (previous?.number ?? 0) + 1, side, context, autoStart: side === "black" };
}

interface Props {
  /** Resolves a Random side; injectable so tests are deterministic. */
  random?: () => number;
  /** Asks the server about a key before a game starts; injectable so tests need no server. */
  checkKey?: (apiKey: string) => Promise<KeyCheck>;
  /** Asks the server for a model's input limit; injectable so tests need no server. */
  modelLimit?: (apiKey: string, model: string) => Promise<number | null>;
}

const serverCheck = (apiKey: string) => checkApiKey(apiUrl(), apiKey);
const serverLimit = (apiKey: string, model: string) => fetchModelLimit(apiUrl(), apiKey, model);

export default function App({
  random = Math.random,
  checkKey = serverCheck,
  modelLimit = serverLimit,
}: Props) {
  const [app, setApp] = useState<AppSettings>(() => loadAppSettings());
  const [setup, setSetup] = useState<Setup>(() => loadSetup());
  const [seat, setSeat] = useState<Seat | null>(() => {
    const threadId = threadFromUrl();
    return threadId ? { number: 0, autoStart: false, ...loadGame(threadId) } : null;
  });
  const [overlay, setOverlay] = useState<Overlay>(() => (seat ? null : NEW_GAME));

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

  // Also persists a key migrated from the old settings on first load.
  useEffect(() => saveAppSettings(app), [app]);

  const onSaveApp = useCallback(
    (next: AppSettings) => {
      setApp(next);
      closeSettings();
    },
    [closeSettings],
  );

  const play = useCallback(
    (next: Setup, context: ChessContext) => {
      saveSetup(next);
      setSetup(next);
      writeThreadToUrl(null);
      const side = resolveSide(next.side, random);
      setSeat((s) => nextSeat(s, side, context));
      setOverlay(null);
    },
    [random],
  );

  const rematch = useCallback((from: Seat) => {
    writeThreadToUrl(null);
    setSeat((s) => nextSeat(s, opposite(from.side), from.context));
  }, []);

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

        {seat ? (
          <Table
            key={seat.number}
            apiKey={app.apiKey}
            seat={seat}
            onRematch={rematch}
            onNewGame={openNewGame}
            onOpenSettings={openSettings}
          />
        ) : (
          <EmptyTable />
        )}
      </div>

      <NewGameDialog
        key={overlay?.kind === "new-game" ? "new-game-open" : "new-game-closed"}
        open={overlay?.kind === "new-game"}
        initial={(overlay?.kind === "new-game" && overlay.draft) || setup}
        canCancel={seat !== null}
        onPlay={play}
        onClose={closeNewGame}
        onOpenSettings={openSettingsFromNewGame}
        checkKey={() => checkKey(app.apiKey)}
        modelLimit={limitFor}
      />
      <AppSettingsDialog
        key={overlay?.kind === "settings" ? "settings-open" : "settings-closed"}
        open={overlay?.kind === "settings"}
        settings={app}
        onSave={onSaveApp}
        onClose={closeSettings}
      />
    </div>
  );
}

/** The board before the first game, behind the New game dialog. */
function EmptyTable() {
  return (
    <main className="grid items-start gap-space-5 lg:grid-cols-[minmax(320px,640px)_minmax(280px,1fr)]">
      <Card intent="neutral" className="flex flex-col gap-space-3">
        <Board fen={START_FEN} orientation="white" humanSide="white" lastMove={null} locked />
        <Text variant="body" color="secondary">
          Choose a side and an opponent to start.
        </Text>
      </Card>
      <aside className="flex flex-col gap-space-4">
        <PlyDetails reply={null} />
        <MoveList entries={[]} startFen={START_FEN} />
      </aside>
    </main>
  );
}

interface TableProps {
  apiKey: string;
  seat: Seat;
  onRematch: (from: Seat) => void;
  onNewGame: () => void;
  onOpenSettings: () => void;
}

function Table({ apiKey, seat, onRematch, onNewGame, onOpenSettings }: TableProps) {
  const game = useGame(apiKey, seat.context, seat.side);
  const [dismissed, setDismissed] = useState<string | null>(null);
  // Run failures arrive on the stream; this holds a submit that failed before it got there.
  const [submitError, setSubmitError] = useState<unknown>(null);
  const autoStarted = useRef(false);

  const over = game.outcome !== null;
  const opponentToMove = sideToMove(game.fen) !== game.humanSide;
  const idle = !game.isLoading && game.pendingMove === null;
  // A pending turn means a run failed mid-turn: only an empty submit resumes it.
  const canRetry = !over && idle && game.pendingTurn;
  const canGo = !over && idle && !game.pendingTurn && opponentToMove;
  // Null follows the game; a number is an earlier position the player stepped back to. A move
  // arriving meanwhile leaves them there: Last (or End) comes back.
  const [viewed, setViewed] = useState<number | null>(null);
  const [orientation, setOrientation] = useState<Side>(game.humanSide);
  const last = game.moves.length;
  const live = viewed === null || viewed >= last;
  const index = live ? last : viewed;
  const go = useCallback(
    (next: number) => setViewed(next >= last ? null : Math.max(0, next)),
    [last],
  );
  usePlyKeys(index, last, go);
  const boardFen = live
    ? (game.pendingMove?.fen ?? game.fen)
    : replay(game.startFen, game.moves.slice(0, index)).fen;
  const lastMove = live
    ? (game.pendingMove?.uci ?? game.moves.at(-1) ?? null)
    : (game.moves[index - 1] ?? null);
  const notice = game.error && game.error !== dismissed ? game.error : null;
  const failure = submitError ?? game.streamError;
  const failureText = describeError(failure);
  const changed = changedKnobs(seat.context);

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

  return (
    <>
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
          <Board
            fen={boardFen}
            orientation={orientation}
            humanSide={game.humanSide}
            lastMove={lastMove}
            locked={
              !live || game.isLoading || over || game.pendingTurn || game.pendingMove !== null
            }
            onMove={(uci, fen) => issue(() => game.play(uci, fen))}
          />
          <BoardControls
            index={index}
            last={last}
            onGo={go}
            onFlip={() => setOrientation((o) => opposite(o))}
          />
          {game.outcome ? (
            <ResultCard
              outcome={game.outcome}
              humanSide={game.humanSide}
              onRematch={() => onRematch(seat)}
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
                    humanSide: game.humanSide,
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
          <PlyDetails reply={game.lastReply} live={game.liveAnalysis} />
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
              {opponentLabel(seat.context)}
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
          </Card>
        </aside>
      </main>
    </>
  );
}
