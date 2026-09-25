import { Banner } from "@langchain/macaw-components/Banner";
import { Button } from "@langchain/macaw-components/Button";
import { Card } from "@langchain/macaw-components/Card";
import { ErrorMessage } from "@langchain/macaw-components/ErrorMessage";
import { GroupedTabs } from "@langchain/macaw-components/GroupedTabs";
import { IconButton } from "@langchain/macaw-components/IconButton";
import { Logo } from "@langchain/macaw-components/Logo";
import { Text } from "@langchain/macaw-components/Text";
import { ThinkingState } from "@langchain/macaw-components/ThinkingState";
import { GearSixIcon } from "@phosphor-icons/react/dist/ssr/GearSix";
import { useCallback, useEffect, useState } from "react";
import Markdown from "react-markdown";
import { sideToMove } from "./chess";
import { Board } from "./components/Board";
import { MoveList } from "./components/MoveList";
import { PlyDetails } from "./components/PlyDetails";
import { SettingsPanel } from "./components/SettingsPanel";
import { ThemeToggle } from "./components/ThemeToggle";
import { describeError, statusLine } from "./format";
import { loadSettings, loadSide, saveSettings, type Settings } from "./settings";
import type { ChessContext, Side } from "./types";
import { threadFromUrl, useGame, writeThreadToUrl } from "./useGame";

const SIDE_TABS = [
  { value: "white", display: "White" },
  { value: "black", display: "Black" },
] as const;

const POLICY_LABELS: Record<ChessContext["policy"], string> = {
  hybrid: "Hybrid",
  llm: "LLM only",
  systemone: "System 1 only",
};

interface Seat {
  /** Changes on every new game, remounting the table so useStream starts a fresh thread. */
  number: number;
  side: Side;
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [open, setOpen] = useState(false);
  const [seat, setSeat] = useState<Seat>(() => ({ number: 0, side: loadSide(threadFromUrl()) }));

  useEffect(() => saveSettings(settings), [settings]);

  const onSave = useCallback((next: Settings) => {
    setSettings(next);
    setOpen(false);
  }, []);

  const newGame = useCallback((side?: Side) => {
    writeThreadToUrl(null);
    setSeat((s) => ({ number: s.number + 1, side: side ?? s.side }));
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
            <GroupedTabs
              value={seat.side}
              onChange={newGame}
              options={SIDE_TABS}
              size="md"
              tooltip="Starts a new game as this colour"
            />
            <Button variant="outlined" color="secondary" size="md" onClick={() => newGame()}>
              New game
            </Button>
            <IconButton
              variant="outlined"
              color="secondary"
              size="md"
              icon={GearSixIcon}
              label="Settings"
              onClick={() => setOpen(true)}
            />
            <ThemeToggle />
          </div>
        </header>

        {!settings.apiKey && (
          <Banner
            intent="warning"
            title="No LangSmith API key"
            action={
              <Button variant="plain" size="sm" color="primary" onClick={() => setOpen(true)}>
                Open settings
              </Button>
            }
          >
            Moves against a deployed server will fail until you add one.
          </Banner>
        )}

        <Table key={seat.number} settings={settings} side={seat.side} />
      </div>

      <SettingsPanel
        key={open ? "open" : "closed"}
        open={open}
        settings={settings}
        onSave={onSave}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}

function Table({ settings, side }: { settings: Settings; side: Side }) {
  const game = useGame(settings.apiKey, settings.context, side);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const over = game.outcome !== null;
  const opponentToMove = sideToMove(game.fen) !== game.humanSide;
  const idle = !game.isLoading && game.pendingMove === null;
  // A pending turn means a run failed mid-turn: only an empty submit resumes it.
  const canRetry = !over && idle && game.pendingTurn;
  const canGo = !over && idle && !game.pendingTurn && opponentToMove;
  const boardFen = game.pendingMove?.fen ?? game.fen;
  const lastMove = game.pendingMove?.uci ?? game.moves.at(-1) ?? null;
  const notice = game.error && game.error !== dismissed ? game.error : null;
  const streamError = describeError(game.streamError);

  // Every new command re-arms the notice, so a repeated rejection shows again.
  const issue = (run: () => Promise<void>) => {
    setDismissed(null);
    void run();
  };

  return (
    <main className="grid items-start gap-space-5 lg:grid-cols-[minmax(320px,640px)_minmax(280px,1fr)]">
      <Card intent="neutral" className="flex flex-col gap-space-3">
        <Board
          fen={boardFen}
          orientation={game.humanSide}
          humanSide={game.humanSide}
          lastMove={lastMove}
          locked={game.isLoading || over || game.pendingTurn || game.pendingMove !== null}
          onMove={(uci, fen) => issue(() => game.play(uci, fen))}
        />
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
        {game.liveAnalysis && (
          <div
            aria-label="live analysis"
            className="markdown max-h-60 overflow-auto rounded-md bg-surface-level-3 p-space-3"
          >
            <Markdown>{game.liveAnalysis}</Markdown>
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
        {streamError && (
          <div role="status">
            <ErrorMessage size="sm" message={streamError} />
          </div>
        )}
      </Card>
      <aside className="flex flex-col gap-space-4">
        <PlyDetails reply={game.lastReply} />
        <MoveList entries={game.entries} startFen={game.startFen} />
        <Card intent="neutral" className="flex flex-col gap-space-2">
          <Text variant="h4" as="h2" color="secondary">
            Opponent
          </Text>
          <Text variant="sm" className="font-mono">
            {opponentName(settings.context)}
          </Text>
          {game.threadId && (
            <Text variant="xs" color="tertiary">
              Thread <span className="font-mono">{game.threadId}</span>
            </Text>
          )}
        </Card>
      </aside>
    </main>
  );
}

function opponentName(context: ChessContext): string {
  const models = {
    llm: context.model,
    systemone: context.systemone_model,
    hybrid: `${context.systemone_model} + ${context.model}`,
  };
  return `${POLICY_LABELS[context.policy]}: ${models[context.policy]}`;
}
