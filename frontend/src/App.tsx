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
import { sideToMove } from "./chess";
import { Board } from "./components/Board";
import { MoveList } from "./components/MoveList";
import { PlyDetails } from "./components/PlyDetails";
import { SettingsPanel } from "./components/SettingsPanel";
import { ThemeToggle } from "./components/ThemeToggle";
import { describeError, statusLine } from "./format";
import { loadSettings, saveSettings, type Settings } from "./settings";
import type { Side } from "./types";
import { useGame, writeThreadToUrl } from "./useGame";

const SIDE_TABS = [
  { value: "white", display: "White" },
  { value: "black", display: "Black" },
] as const;

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [open, setOpen] = useState(false);
  // Remounting the table gives useStream a fresh thread; the key changes on every new game.
  const [gameNumber, setGameNumber] = useState(0);

  useEffect(() => saveSettings(settings), [settings]);

  const onSave = useCallback((next: Settings) => {
    setSettings(next);
    setOpen(false);
  }, []);

  const newGame = useCallback(() => {
    writeThreadToUrl(null);
    setGameNumber((n) => n + 1);
  }, []);

  const chooseSide = useCallback(
    (side: Side) => {
      setSettings((s) => ({ ...s, context: { ...s.context, human_side: side } }));
      newGame();
    },
    [newGame],
  );

  return (
    <div className="min-h-screen bg-surface-level-1 text-primary">
      <div className="mx-auto flex max-w-6xl flex-col gap-space-5 px-space-5 pb-space-8 pt-space-5">
        <header className="flex flex-wrap items-center justify-between gap-space-4">
          <div className="flex items-center gap-space-3">
            <Logo brand="langchain" variant="logomark" size="sm" />
            <Text variant="h2" as="h1">
              Jev Chess
            </Text>
          </div>
          <div className="flex items-center gap-space-2">
            <GroupedTabs
              value={settings.context.human_side}
              onChange={chooseSide}
              options={SIDE_TABS}
              size="md"
              tooltip="Starts a new game as this colour"
            />
            <Button variant="outlined" color="secondary" size="md" onClick={newGame}>
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

        <Table key={gameNumber} settings={settings} />
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

function Table({ settings }: { settings: Settings }) {
  const game = useGame(settings.apiKey, settings.context);

  const needsStart =
    game.humanSide === "black" && game.history.length === 0 && game.status === "playing";
  // The opponent's turn with nothing in flight means its last move failed; an empty submit retries.
  const canRetry =
    !needsStart &&
    game.status === "playing" &&
    game.pendingFen === null &&
    sideToMove(game.fen) !== game.humanSide;
  const boardFen = game.pendingFen ?? game.fen;
  const lastMove = game.plies.at(-1)?.uci ?? null;
  const streamError = describeError(game.streamError);
  const error = game.error ?? streamError;

  return (
    <main className="grid items-start gap-space-5 lg:grid-cols-[minmax(320px,640px)_minmax(280px,1fr)]">
      <Card intent="neutral" className="flex flex-col gap-space-3">
        <Board
          fen={boardFen}
          orientation={game.humanSide}
          humanSide={game.humanSide}
          lastMove={lastMove}
          locked={game.isLoading || game.status !== "playing" || game.pendingFen !== null}
          onMove={(uci, fen) => void game.play(uci, fen)}
        />
        <div className="flex min-h-8 items-center justify-between gap-space-3">
          {game.isThinking ? (
            <ThinkingState
              label={`${game.player || "Opponent"} is thinking`}
              tone="brand"
              size="sm"
              showElapsed
            />
          ) : (
            <Text variant="body" color="secondary">
              {statusLine(game)}
            </Text>
          )}
          {needsStart && !game.isThinking && (
            <Button color="primary" size="md" onClick={() => void game.start()}>
              Start
            </Button>
          )}
          {canRetry && !game.isLoading && (
            <Button
              variant="outlined"
              color="secondary"
              size="md"
              onClick={() => void game.start()}
            >
              Retry opponent move
            </Button>
          )}
        </div>
        {error && (
          <div role="status">
            <ErrorMessage size="sm" message={error} />
          </div>
        )}
      </Card>
      <aside className="flex flex-col gap-space-4">
        <PlyDetails ply={game.lastPolicyPly} context={settings.context} />
        <MoveList plies={game.plies} />
        <Card intent="neutral" className="flex flex-col gap-space-2">
          <Text variant="h4" as="h2" color="secondary">
            Opponent
          </Text>
          <Text variant="sm" className="font-mono">
            {game.player || settings.context.policy}
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
