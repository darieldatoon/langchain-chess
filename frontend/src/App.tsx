import { useCallback, useEffect, useState } from "react";
import { Banner } from "./components/Banner";
import { Board } from "./components/Board";
import { MoveList } from "./components/MoveList";
import { PlyDetails } from "./components/PlyDetails";
import { SettingsPanel } from "./components/SettingsPanel";
import { sideToMove } from "./chess";
import { describeError, statusLine } from "./format";
import { loadSettings, saveSettings, type Settings } from "./settings";
import { useGame } from "./useGame";

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [open, setOpen] = useState(false);
  const game = useGame(settings.apiKey, settings.context);

  useEffect(() => saveSettings(settings), [settings]);

  const onSave = useCallback((next: Settings) => {
    setSettings(next);
    setOpen(false);
  }, []);

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
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>Jev Chess</h1>
          <span>System 1 vs System 2</span>
        </div>
        <div className="actions">
          <button type="button" onClick={game.newGame} disabled={game.isLoading}>
            New game
          </button>
          <button type="button" onClick={() => setOpen(true)}>
            Settings
          </button>
        </div>
      </header>

      {!settings.apiKey && <Banner onOpenSettings={() => setOpen(true)} />}

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

      {open && <SettingsPanel settings={settings} onSave={onSave} onClose={() => setOpen(false)} />}
    </div>
  );
}
