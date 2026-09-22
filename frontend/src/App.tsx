import { useCallback, useEffect, useState } from "react";
import { Banner } from "./components/Banner";
import { Board } from "./components/Board";
import { MoveList } from "./components/MoveList";
import { PlyDetails } from "./components/PlyDetails";
import { SettingsPanel } from "./components/SettingsPanel";
import { sideToMove } from "./chess";
import { describeError, statusLine } from "./format";
import type { Side } from "./types";
import { loadSettings, saveSettings, type Settings } from "./settings";
import { useGame, writeThreadToUrl } from "./useGame";

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
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>Jev Chess</h1>
        </div>
        <div className="actions">
          <div className="segmented" role="group" aria-label="Your colour">
            {(["white", "black"] as const).map((side) => (
              <button
                key={side}
                type="button"
                aria-pressed={settings.context.human_side === side}
                onClick={() => chooseSide(side)}
                title="Starts a new game as this colour"
              >
                {side === "white" ? "White" : "Black"}
              </button>
            ))}
          </div>
          <button type="button" onClick={newGame}>
            New game
          </button>
          <button type="button" onClick={() => setOpen(true)}>
            Settings
          </button>
        </div>
      </header>

      {!settings.apiKey && <Banner onOpenSettings={() => setOpen(true)} />}

      <Table key={gameNumber} settings={settings} />

      {open && <SettingsPanel settings={settings} onSave={onSave} onClose={() => setOpen(false)} />}
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

  return (
    <main className="layout">
      <div className="board-wrap">
        <Board
          fen={boardFen}
          orientation={game.humanSide}
          humanSide={game.humanSide}
          lastMove={lastMove}
          locked={game.isLoading || game.status !== "playing" || game.pendingFen !== null}
          onMove={(uci, fen) => void game.play(uci, fen)}
        />
        <div className="status">
          {game.isThinking ? (
            <span className="thinking">{game.player || "Opponent"} is thinking…</span>
          ) : (
            <span>{statusLine(game)}</span>
          )}
          {needsStart && !game.isThinking && (
            <button type="button" className="primary" onClick={() => void game.start()}>
              Start
            </button>
          )}
          {canRetry && !game.isLoading && (
            <button type="button" onClick={() => void game.start()}>
              Retry opponent move
            </button>
          )}
        </div>
        {(game.error || streamError) && (
          <div className="status error" role="status">
            {game.error ?? streamError}
          </div>
        )}
      </div>
      <aside className="side">
        <PlyDetails ply={game.lastPolicyPly} context={settings.context} />
        <MoveList plies={game.plies} />
        <section className="card">
          <h2>Opponent</h2>
          <p className="mono" style={{ margin: 0, fontSize: 13 }}>
            {game.player || settings.context.policy}
          </p>
          {game.threadId && (
            <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
              Thread <span className="mono">{game.threadId}</span>
            </p>
          )}
        </section>
      </aside>
    </main>
  );
}
