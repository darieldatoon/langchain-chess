import {
  InMemoryWebStorage,
  UserManager,
  WebStorageStateStore,
  type INavigator,
  type User,
} from "oidc-client-ts";
import type { LangSmithApp } from "./config";
import type { Session } from "./session";
import type { Account } from "./stored";

export const LANGSMITH_API_URL = "https://api.smith.langchain.com";
export const LANGSMITH_APP_URL = "https://smith.langchain.com";
const RENEW_WITHIN_SECONDS = 30;

export type OAuthSession = Extract<Session, { kind: "oauth" }>;

export type Resumed =
  | { readonly kind: "signed-in"; readonly session: OAuthSession; readonly account: Account | null }
  /** Approved for another org on LangSmith's consent page; that sign-in is already forgotten. */
  | { readonly kind: "wrong-organization"; readonly email: string | null };

export interface LangSmithSignIn {
  /** Sign-in goes through the org's SSO login, which also switches LangSmith accounts. */
  readonly singleSignOn: boolean;
  /**
   * Leaves for LangSmith's consent page; the page's query (the game) and hash come back after.
   * `chooseOrganization` shows the page even when the user approved the app before.
   */
  start(options?: { readonly chooseOrganization?: boolean }): Promise<void>;
  /** After LangSmith redirects back, or after a reload; null when signed out. */
  resume(location: Location): Promise<Resumed | null>;
  /** Revokes the refresh token and forgets this tab's tokens. */
  signOut(): Promise<void>;
}

/** The parts of oidc-client-ts's UserManager sign-in uses. */
export type SignInManager = Pick<
  UserManager,
  | "getUser"
  | "signinSilent"
  | "removeUser"
  | "revokeTokens"
  | "signinRedirect"
  | "signinRedirectCallback"
>;

/** Where the page was when sign-in started. */
interface Return {
  readonly search?: string;
  readonly hash?: string;
}

export function isSignInCallback(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has("state") && (params.has("code") || params.has("error"));
}

/**
 * The org's SSO login, then LangSmith's consent page for the same request. Skipping
 * /oauth/authorize is safe: LangSmith repeats its checks when the user approves.
 */
export function ssoSignInUrl(authorizeUrl: string, ssoSlug: string): string {
  const url = new URL(`/sso/login/${encodeURIComponent(ssoSlug)}`, LANGSMITH_APP_URL);
  url.searchParams.set("redirect_to", `/oauth/consent${new URL(authorizeUrl).search}`);
  return url.href;
}

export function redirectThrough(
  rewrite: (url: string) => string,
  assign: (url: string) => void,
): INavigator {
  return {
    prepare: async () => ({
      navigate: ({ url }) =>
        new Promise((resolve) => {
          window.addEventListener("pageshow", () => resolve({ url: window.location.href }));
          assign(rewrite(url));
        }),
      close: () => undefined,
    }),
    callback: async () => undefined,
  };
}

/** The token's `organization_id` claim, unverified: the server checks the signature. */
export function tokenOrganization(accessToken: string): string | null {
  try {
    const payload = accessToken.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(payload)) as { organization_id?: unknown };
    return typeof claims.organization_id === "string" ? claims.organization_id : null;
  } catch {
    return null;
  }
}

export function userManager(
  app: LangSmithApp,
  /** Registered on the OAuth app exactly, trailing slash included. */
  redirectUri: string,
  storage: Storage,
  assign: (url: string) => void = window.location.assign.bind(window.location),
): UserManager {
  const store = new WebStorageStateStore({ store: storage });
  const { ssoSlug } = app;
  return new UserManager(
    {
      authority: LANGSMITH_API_URL,
      client_id: app.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile offline_access",
      // Without it the token only works at /userinfo; with it, at the server.
      resource: LANGSMITH_API_URL,
      loadUserInfo: false,
      userStore: store,
      stateStore: store,
      // Renewal happens on demand in accessToken(), so two refreshes never race.
      automaticSilentRenew: false,
    },
    ssoSlug ? redirectThrough((url) => ssoSignInUrl(url, ssoSlug), assign) : undefined,
  );
}

export function langsmithSignIn(options: {
  readonly app: LangSmithApp;
  readonly manager: SignInManager;
  /** The refresh token stopped working: the user must sign in again. */
  readonly onExpired: () => void;
  readonly history?: Pick<History, "replaceState">;
}): LangSmithSignIn {
  const { app, manager, onExpired, history = window.history } = options;
  let renewal: Promise<User | null> | null = null;
  let signedOut = false;
  const signedOutError = () => new Error("You're signed out. Sign in again to continue.");
  // Every await can resume after sign-out started, so check again before starting or using a refresh.
  const accessToken = async () => {
    if (signedOut) throw signedOutError();
    const user = await manager.getUser();
    if (!user || signedOut) throw signedOutError();
    if ((user.expires_in ?? 0) > RENEW_WITHIN_SECONDS) return user.access_token;
    // Refresh tokens rotate, and LangSmith revokes them all when one is reused.
    renewal ??= manager.signinSilent().finally(() => {
      renewal = null;
    });
    const renewed = await renewal.catch(() => null);
    if (signedOut) throw signedOutError();
    if (!renewed) {
      await manager.removeUser();
      onExpired();
      throw new Error("Your LangSmith sign-in expired. Sign in again to continue.");
    }
    return renewed.access_token;
  };

  // A refresh still in flight would store a new session after sign-out, so wait for it and revoke the newest token.
  const signOut = async () => {
    signedOut = true;
    try {
      await renewal?.catch(() => undefined);
      await manager.revokeTokens(["refresh_token"]).catch(() => undefined);
    } finally {
      await manager.removeUser();
    }
  };
  // The server refuses other orgs' tokens too; checking here turns that refusal into a way out.
  const admit = async (user: User): Promise<Resumed> => {
    const email = user.profile.email ?? null;
    if (tokenOrganization(user.access_token) === app.organizationId) {
      return {
        kind: "signed-in",
        session: { kind: "oauth", email, accessToken },
        account: email ? { email } : null,
      };
    }
    await signOut();
    return { kind: "wrong-organization", email };
  };

  // StrictMode runs effects twice, and an authorization code works once.
  let callback: Promise<User> | null = null;
  return {
    singleSignOn: app.ssoSlug !== null,
    start: (start) =>
      manager.signinRedirect({
        state: { search: window.location.search, hash: window.location.hash } satisfies Return,
        prompt: start?.chooseOrganization ? "consent" : undefined,
      }),
    resume: async (location) => {
      if (!isSignInCallback(location.search)) {
        const user = await manager.getUser();
        return user && (user.refresh_token || !user.expired) ? admit(user) : null;
      }
      try {
        callback ??= manager.signinRedirectCallback(location.href);
        const user = await callback;
        const back = (user.state ?? {}) as Return;
        history.replaceState(null, "", location.pathname + (back.search ?? "") + (back.hash ?? ""));
        return await admit(user);
      } catch (error) {
        history.replaceState(null, "", location.pathname + location.hash);
        throw error;
      }
    },
    signOut,
  };
}

export type MakeSignIn = (onExpired: () => void) => LangSmithSignIn;

/** Sign-in for this site, keeping tokens in the tab's storage, or in memory where it's blocked. */
export function makeSignIn(app: LangSmithApp, tab: Storage | null): MakeSignIn {
  // Registered on the OAuth app exactly: the site's root, trailing slash included.
  const redirectUri = window.location.origin + import.meta.env.BASE_URL;
  return (onExpired) =>
    langsmithSignIn({
      app,
      manager: userManager(app, redirectUri, tab ?? new InMemoryWebStorage()),
      onExpired,
    });
}
