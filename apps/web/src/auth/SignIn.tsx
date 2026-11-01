import { Banner } from "@langchain/macaw-components/Banner";
import { Button } from "@langchain/macaw-components/Button";
import { Input } from "@langchain/macaw-components/Input";
import { Link } from "@langchain/macaw-components/Link";
import { Logo } from "@langchain/macaw-components/Logo";
import { Text } from "@langchain/macaw-components/Text";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { BuildingsIcon } from "@phosphor-icons/react/dist/ssr/Buildings";
import { TOUCH_TARGET } from "@langchain-chess/chess-ui";
import { useState, type FormEvent } from "react";
import { keyCheckMessage, type KeyCheck } from "./check";
import { LANGSMITH_APP_URL, type LangSmithSignIn } from "./oauth";
import type { Account } from "./stored";
import type { SignInProblem } from "./useSession";

interface Props {
  /** Null when the build has no OAuth app; only API keys work then. */
  readonly langsmith: LangSmithSignIn | null;
  readonly problem?: SignInProblem;
  readonly lastAccount: Account | null;
  readonly onForgetAccount: () => void;
  /** Asks the server about a key before it is kept. */
  readonly checkKey: (apiKey: string) => Promise<KeyCheck>;
  readonly onSignInWithKey: (apiKey: string) => void;
  readonly onRetry: () => void;
}

export function SignIn({
  langsmith,
  problem,
  lastAccount,
  onForgetAccount,
  checkKey,
  onSignInWithKey,
  onRetry,
}: Props) {
  const wrongOrganization = problem?.kind === "wrong-organization" ? problem : null;
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(!langsmith);
  const [busy, setBusy] = useState<"langsmith" | "key" | null>(null);
  // This screen's own failures; `problem` is why it opened.
  const [error, setError] = useState<string | null>(null);

  const startLangSmith = async () => {
    setBusy("langsmith");
    setError(null);
    try {
      await langsmith!.start({ chooseOrganization: wrongOrganization !== null });
    } catch (cause) {
      setBusy(null);
      setError(cause instanceof Error ? cause.message : "Couldn't reach LangSmith.");
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("key");
    setError(null);
    const key = apiKey.trim();
    const check = await checkKey(key);
    if (check.kind === "ok") return onSignInWithKey(key);
    setBusy(null);
    setError(keyCheckMessage(check).body);
  };

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-surface-level-1 p-space-4 text-primary">
      <div className="flex w-full max-w-md flex-col gap-space-4 rounded-lg border border-default bg-surface-level-2 p-space-6">
        <div className="flex flex-col gap-space-2">
          <div className="flex items-center gap-space-3">
            <Logo brand="langchain" variant="logomark" size="sm" />
            <Text variant="h2" as="h1">
              LangChain Chess
            </Text>
          </div>
          <Text variant="sm" color="secondary">
            {langsmith
              ? "Sign in with your LangSmith account. Members of this deployment's LangSmith organization only."
              : "Sign in with a LangSmith API key from this deployment's workspace. It stays in this tab only."}
          </Text>
        </div>
        {langsmith && (
          <>
            {wrongOrganization && (
              <Banner intent="warning" title="That account isn't in this organization">
                LangSmith signed you in
                {wrongOrganization.email ? ` as ${wrongOrganization.email}` : ""} for another
                organization.{" "}
                {langsmith.singleSignOn ? (
                  "Try again to sign in through the organization's single sign-on."
                ) : (
                  <>
                    If it uses a different login, such as Okta, sign out at{" "}
                    <Link href={LANGSMITH_APP_URL} target="_blank" rel="noreferrer">
                      smith.langchain.com
                    </Link>
                    , sign in with that login, then try again.
                  </>
                )}
              </Banner>
            )}
            {lastAccount && !wrongOrganization ? (
              <div className="flex flex-col gap-space-2">
                <Text variant="xs" color="tertiary">
                  Last used
                </Text>
                <button
                  type="button"
                  disabled={busy !== null}
                  aria-busy={busy === "langsmith"}
                  onClick={() => void startLangSmith()}
                  className={`flex w-full items-center gap-space-3 rounded-md border border-default bg-surface-level-1 p-space-4 text-left hover:bg-surface-level-1-hover disabled:opacity-60 ${TOUCH_TARGET}`}
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-level-2">
                    <BuildingsIcon size={20} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <Text as="span" variant="body" className="truncate">
                      {lastAccount.email}
                    </Text>
                    <Text as="span" variant="xs" color="secondary">
                      {langsmith.singleSignOn ? "Single sign-on" : "LangSmith"}
                    </Text>
                  </span>
                  <ArrowRightIcon size={18} />
                </button>
                <Button
                  variant="outlined"
                  color="secondary"
                  size="md"
                  className={TOUCH_TARGET}
                  disabled={busy !== null}
                  onClick={onForgetAccount}
                >
                  Use another account
                </Button>
              </div>
            ) : (
              <Button
                color="primary"
                size="md"
                className={TOUCH_TARGET}
                loading={busy === "langsmith"}
                disabled={busy !== null}
                onClick={() => void startLangSmith()}
              >
                {wrongOrganization ? "Try again" : "Sign in with LangSmith"}
              </Button>
            )}
            <Button
              variant="plain"
              color="secondary"
              size="sm"
              className={TOUCH_TARGET}
              aria-expanded={showKey}
              onClick={() => setShowKey((shown) => !shown)}
            >
              {showKey ? "Hide advanced" : "Advanced"}
            </Button>
            {showKey && (
              <Text variant="xs" color="tertiary">
                Use a LangSmith API key from this deployment's workspace instead. It stays in this
                tab only.
              </Text>
            )}
          </>
        )}
        {showKey && (
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-space-4">
            <Input
              id="api-key"
              size="md"
              type="password"
              label="LangSmith API key"
              placeholder="lsv2_…"
              value={apiKey}
              debounceMs={0}
              onChange={setApiKey}
              autoFocus={!langsmith}
              required
            />
            <Button
              type="submit"
              color={langsmith ? "secondary" : "primary"}
              variant={langsmith ? "outlined" : "normal"}
              size="md"
              className={TOUCH_TARGET}
              loading={busy === "key"}
              disabled={!apiKey.trim() || busy !== null}
            >
              {langsmith ? "Sign in with API key" : "Sign in"}
            </Button>
          </form>
        )}
        {error ? (
          <Banner intent="error">{error}</Banner>
        ) : problem?.kind === "error" ? (
          <Banner
            intent="error"
            action={
              <Button
                variant="plain"
                size="sm"
                color="primary"
                className={TOUCH_TARGET}
                onClick={onRetry}
              >
                Try again
              </Button>
            }
          >
            {problem.message}
          </Banner>
        ) : problem?.kind === "expired" ? (
          <Banner intent="warning" title="Signed out">
            Your LangSmith sign-in expired. Sign in again to continue this game.
          </Banner>
        ) : null}
      </div>
    </main>
  );
}
