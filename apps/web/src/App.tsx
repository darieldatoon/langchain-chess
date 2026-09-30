import { Banner } from "@langchain/macaw-components/Banner";
import { Button } from "@langchain/macaw-components/Button";
import { IconButton } from "@langchain/macaw-components/IconButton";
import { Logo } from "@langchain/macaw-components/Logo";
import { Text } from "@langchain/macaw-components/Text";
import { GearSixIcon } from "@phosphor-icons/react/dist/ssr/GearSix";
import { useCallback, useRef, useState } from "react";
import {
  allocate,
  GAP,
  layoutFor,
  opposite,
  PHONE_PADDING,
  TOUCH_TARGET,
  useCoarsePointer,
  useContainerLayout,
  WEB_LEFT,
  type ChessContext,
  type PlyView,
  type Side,
} from "@langchain-chess/chess-ui";
import { checkApiKey, type KeyCheck } from "./auth";
import { fetchModelFacts, type ModelFacts } from "./modelFacts";
import { AppMenu } from "./components/AppMenu";
import { AppSettingsDialog } from "./components/AppSettingsDialog";
import { NewGameDialog } from "./components/NewGameDialog";
import { ThemeToggle } from "./components/ThemeToggle";
import { apiUrl } from "./settings";
import { resolveSide, type GameRecord, type Setup } from "./setup";
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
import { EmptyTable, Table, type Seat } from "./Table";
import { threadFromUrl, writeThreadToUrl } from "./useGame";

/** The main region's padding, top and bottom, off phones. */
const PAD_TOP = 8;

/** Settings opened from New game go back to it; `draft` holds the picks not yet played. */
type Overlay =
  | { kind: "new-game"; draft: Setup | null }
  | { kind: "settings"; back: Overlay }
  | null;

const NEW_GAME: Overlay = { kind: "new-game", draft: null };

function nextSeat(previous: Seat | null, side: Side, context: ChessContext): Seat {
  return {
    number: (previous?.number ?? 0) + 1,
    chosen: { side, context },
    autoStart: side === "black",
  };
}

interface Props {
  /** Resolves a Random side; injectable so tests are deterministic. */
  random?: () => number;
  /** Asks the server about a key before a game starts; injectable so tests need no server. */
  checkKey?: (apiKey: string) => Promise<KeyCheck>;
  /** Asks the server what it knows about a model; injectable so tests need no server. */
  modelFacts?: (apiKey: string, model: string) => Promise<ModelFacts>;
}

const serverCheck = (apiKey: string) => checkApiKey(apiUrl(), apiKey);
const serverFacts = (apiKey: string, model: string) => fetchModelFacts(apiUrl(), apiKey, model);

export default function App({
  random = Math.random,
  checkKey = serverCheck,
  modelFacts = serverFacts,
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
  const factsFor = useCallback(
    (model: string) => modelFacts(app.apiKey, model),
    [modelFacts, app.apiKey],
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
      setSeat((s) => nextSeat(s, side, context));
      setOverlay(null);
    },
    [random, noteSaved],
  );

  const rematch = useCallback((from: GameRecord) => {
    writeThreadToUrl(null);
    setSeat((s) => nextSeat(s, opposite(from.side), from.context));
  }, []);

  // The same thread, on a fresh stream: the URL still names it.
  const reload = useCallback(
    (from: Seat) => setSeat({ ...from, number: from.number + 1, autoStart: false }),
    [],
  );

  const main = useRef<HTMLElement>(null);
  const space = useContainerLayout(main);
  const coarse = useCoarsePointer();
  const layout = layoutFor({ ...space, left: WEB_LEFT.min, evalBar: 0 });
  const phone = layout === "phone";
  // Phones keep the page padding inside the board's own sizing.
  const pad = phone ? 0 : GAP;
  const allocation = allocate({
    layout,
    width: space.width - 2 * pad,
    height: space.height - PAD_TOP - pad,
    left: WEB_LEFT,
    evalBar: 0,
    coarse,
    scale: 1,
  });

  return (
    <div className="flex h-[100dvh] flex-col bg-surface-level-1 text-primary">
      <header
        className="flex shrink-0 items-center justify-between gap-space-3 py-space-3"
        style={{ paddingInline: phone ? PHONE_PADDING : GAP }}
      >
        <div className="flex items-center gap-space-3">
          <Logo brand="langchain" variant="logomark" size="sm" />
          {!phone && (
            <Text variant="h2" as="h1">
              LangChain Chess
            </Text>
          )}
        </div>
        <div className="flex items-center gap-space-2">
          <Button color="primary" size="md" className={TOUCH_TARGET} onClick={openNewGame}>
            New game
          </Button>
          {phone ? (
            <AppMenu onOpenSettings={openSettings} />
          ) : (
            <>
              <IconButton
                variant="outlined"
                color="secondary"
                size="md"
                icon={GearSixIcon}
                label="Settings"
                className={TOUCH_TARGET}
                onClick={openSettings}
              />
              <ThemeToggle />
            </>
          )}
        </div>
      </header>

      <main
        ref={main}
        className="flex min-h-0 flex-1 flex-col gap-space-3 overflow-y-auto overflow-x-hidden"
        style={{ padding: phone ? `0 ${PHONE_PADDING}px 8px` : `${PAD_TOP}px ${GAP}px ${GAP}px` }}
      >
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
            allocation={allocation}
          />
        ) : (
          <EmptyTable view={view} onViewChange={onViewChange} allocation={allocation} />
        )}
      </main>

      {overlay?.kind === "new-game" && (
        <NewGameDialog
          initial={overlay.draft ?? setup}
          canCancel={seat !== null}
          onPlay={play}
          onClose={closeNewGame}
          onOpenSettings={openSettingsFromNewGame}
          checkKey={() => checkKey(app.apiKey)}
          modelFacts={factsFor}
        />
      )}
      {overlay?.kind === "settings" && (
        <AppSettingsDialog settings={app} onSave={onSaveApp} onClose={closeSettings} />
      )}
    </div>
  );
}
