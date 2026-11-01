import { Banner } from "@langchain/macaw-components/Banner";
import { useCallback, useMemo } from "react";
import App from "./App.tsx";
import { checkAccess, type KeyCheck } from "./auth/check";
import { langsmithAppConfig, type LangSmithApp, type LangSmithAppConfig } from "./auth/config";
import { makeSignIn, type MakeSignIn } from "./auth/oauth";
import type { Session } from "./auth/session";
import { SignIn } from "./auth/SignIn";
import { tabStorage } from "./auth/stored";
import { useSession, type SessionDeps } from "./auth/useSession";
import { apiUrl } from "./settings";
import { browserStorage } from "./storage";

const serverCheck = (session: Session) => checkAccess(apiUrl(), session);

interface Props {
  config?: LangSmithAppConfig;
  /** Injectable so tests need no LangSmith. */
  signIn?: (app: LangSmithApp, tab: Storage | null) => MakeSignIn;
  /** Injectable so tests need no server. */
  check?: (session: Session) => Promise<KeyCheck>;
  tab?: Storage | null;
  local?: Storage | null;
}

const CONFIG = langsmithAppConfig();

/** Sign in, then the game. */
export default function Root({
  config = CONFIG,
  signIn = makeSignIn,
  check = serverCheck,
  tab = tabStorage(),
  local = browserStorage(),
}: Props) {
  if (!config.ok) {
    return (
      <main className="p-space-4">
        <Banner intent="error" title="This build is misconfigured">
          {config.problem}
        </Banner>
      </main>
    );
  }
  return <Signed app={config.app} signIn={signIn} check={check} tab={tab} local={local} />;
}

function Signed({
  app,
  signIn,
  check,
  tab,
  local,
}: Omit<SessionDeps, "makeSignIn"> & {
  app: LangSmithApp | null;
  signIn: (app: LangSmithApp, tab: Storage | null) => MakeSignIn;
}) {
  const make = useMemo(() => (app ? signIn(app, tab) : null), [app, signIn, tab]);
  const { state, langsmith, lastAccount, forgetAccount, signInWithKey, signOut, retry } =
    useSession({ makeSignIn: make, check, tab, local });
  const checkKey = useCallback((apiKey: string) => check({ kind: "apiKey", apiKey }), [check]);

  switch (state.status) {
    case "checking":
      return <main aria-busy="true" className="h-[100dvh] bg-surface-level-1" />;
    case "signed-out":
      return (
        <SignIn
          langsmith={langsmith}
          problem={state.problem}
          lastAccount={lastAccount}
          onForgetAccount={forgetAccount}
          checkKey={checkKey}
          onSignInWithKey={signInWithKey}
          onRetry={retry}
        />
      );
    case "signed-in":
      return <App session={state.session} onSignOut={() => void signOut()} />;
  }
}
