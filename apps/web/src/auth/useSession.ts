import { useCallback, useEffect, useMemo, useState } from "react";
import type { KeyCheck } from "./check";
import type { LangSmithSignIn } from "./oauth";
import { NO_SESSION, type Session } from "./session";
import {
  clearApiKey,
  forgetLastAccount,
  forgetLegacyApiKey,
  loadApiKey,
  loadLastAccount,
  saveApiKey,
  saveLastAccount,
  type Account,
} from "./stored";

export type SignInProblem =
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "wrong-organization"; readonly email: string | null }
  /** The refresh token stopped working mid-session. */
  | { readonly kind: "expired" };

export type SessionState =
  | { readonly status: "checking" }
  | { readonly status: "signed-out"; readonly problem?: SignInProblem }
  | { readonly status: "signed-in"; readonly session: Session };

export interface SessionDeps {
  /** Null when the build has no OAuth app. `onExpired` sends the user back to sign in. */
  readonly makeSignIn: ((onExpired: () => void) => LangSmithSignIn) | null;
  /** Asks the server whether it takes a session. */
  readonly check: (session: Session) => Promise<KeyCheck>;
  /** sessionStorage, for the API key. */
  readonly tab: Storage | null;
  /** localStorage, for the last account. */
  readonly local: Storage | null;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A tab's sign-in, in order: a LangSmith sign-in, this tab's API key, else none if the server
 * takes none. */
async function resumeSession(
  langsmith: LangSmithSignIn | null,
  { check, tab, local }: Omit<SessionDeps, "makeSignIn">,
  remember: (account: Account) => void,
): Promise<SessionState> {
  forgetLegacyApiKey(local);
  const resumed = langsmith ? await langsmith.resume(window.location) : null;
  if (resumed?.kind === "signed-in") {
    if (resumed.account) remember(resumed.account);
    return { status: "signed-in", session: resumed.session };
  }
  if (resumed) return { status: "signed-out", problem: resumed };
  const apiKey = loadApiKey(tab);
  if (apiKey) return { status: "signed-in", session: { kind: "apiKey", apiKey } };
  const open = await check(NO_SESSION);
  if (open.kind === "ok") return { status: "signed-in", session: NO_SESSION };
  if (open.kind === "unreachable") {
    return {
      status: "signed-out",
      problem: { kind: "error", message: `Couldn't reach the server: ${open.message}` },
    };
  }
  return { status: "signed-out" };
}

export function useSession(deps: SessionDeps) {
  const { makeSignIn, check, tab, local } = deps;
  const [state, setState] = useState<SessionState>({ status: "checking" });
  const langsmith = useMemo(
    () =>
      makeSignIn?.(() => setState({ status: "signed-out", problem: { kind: "expired" } })) ?? null,
    [makeSignIn],
  );
  const [lastAccount, setLastAccount] = useState<Account | null>(() => loadLastAccount(local));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const settle = (next: SessionState) => cancelled || setState(next);
    const remember = (account: Account) => {
      saveLastAccount(local, account);
      setLastAccount(account);
    };
    resumeSession(langsmith, { check, tab, local }, remember).then(settle, (error: unknown) =>
      settle({ status: "signed-out", problem: { kind: "error", message: message(error) } }),
    );
    return () => {
      cancelled = true;
    };
  }, [langsmith, check, tab, local, attempt]);

  const retry = useCallback(() => {
    setState({ status: "checking" });
    setAttempt((a) => a + 1);
  }, []);

  const signInWithKey = useCallback(
    (apiKey: string) => {
      saveApiKey(tab, apiKey);
      setState({ status: "signed-in", session: { kind: "apiKey", apiKey: apiKey.trim() } });
    },
    [tab],
  );

  const signOut = useCallback(async () => {
    if (state.status === "signed-in" && state.session.kind === "oauth") await langsmith?.signOut();
    clearApiKey(tab);
    setState({ status: "signed-out" });
  }, [state, langsmith, tab]);

  const forgetAccount = useCallback(() => {
    forgetLastAccount(local);
    setLastAccount(null);
  }, [local]);

  return { state, langsmith, lastAccount, forgetAccount, signInWithKey, signOut, retry };
}
