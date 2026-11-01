import type { INavigator, User } from "oidc-client-ts";
import { InMemoryWebStorage } from "oidc-client-ts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { LangSmithApp } from "../../src/auth/config";
import {
  isSignInCallback,
  langsmithSignIn,
  LANGSMITH_API_URL,
  makeSignIn,
  redirectThrough,
  ssoSignInUrl,
  tokenOrganization,
  userManager,
  type OAuthSession,
  type Resumed,
  type SignInManager,
} from "../../src/auth/oauth";

const APP: LangSmithApp = { clientId: "lsc_chess", organizationId: "org-1", ssoSlug: null };

function base64url(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** An access token whose payload names `organization_id`; the signature is the server's to check. */
const tokenFor = (organization_id: string | null, extra = "") =>
  `h.${base64url({ organization_id, extra })}.s`;

function user(overrides: Partial<User> = {}): User {
  return {
    access_token: tokenFor("org-1"),
    refresh_token: "refresh",
    expires_in: 300,
    expired: false,
    profile: { email: "ada@example.com" },
    state: undefined,
    ...overrides,
  } as unknown as User;
}

function fakeManager(current: User | null = user()) {
  const manager = {
    getUser: vi.fn(() => Promise.resolve(current)),
    signinSilent: vi.fn(() => Promise.resolve(user({ access_token: "renewed" }))),
    removeUser: vi.fn(() => Promise.resolve()),
    revokeTokens: vi.fn(() => Promise.resolve()),
    signinRedirect: vi.fn(() => Promise.resolve()),
    signinRedirectCallback: vi.fn(() => Promise.resolve(user())),
  };
  return manager satisfies { [K in keyof SignInManager]: unknown };
}

function signIn(manager = fakeManager(), app = APP) {
  const onExpired = vi.fn();
  const history = { replaceState: vi.fn() };
  const langsmith = langsmithSignIn({
    app,
    manager: manager as unknown as SignInManager,
    onExpired,
    history,
  });
  return { langsmith, manager, onExpired, history };
}

const at = (url: string) => new URL(url) as unknown as Location;

async function signedIn(langsmith: ReturnType<typeof signIn>["langsmith"]): Promise<OAuthSession> {
  const resumed = await langsmith.resume(at("https://chess.test/app/"));
  if (resumed?.kind !== "signed-in") throw new Error(`not signed in: ${JSON.stringify(resumed)}`);
  return resumed.session;
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("helpers", () => {
  it("tells LangSmith's redirect back from a page of the app", () => {
    expect(isSignInCallback("?code=c&state=s")).toBe(true);
    expect(isSignInCallback("?error=access_denied&state=s")).toBe(true);
    expect(isSignInCallback("?thread=t-1")).toBe(false);
    expect(isSignInCallback("?code=c")).toBe(false);
  });

  it("sends SSO sign-in through the org's login, then the consent page", () => {
    const url = new URL(
      ssoSignInUrl(`${LANGSMITH_API_URL}/oauth/authorize?client_id=c&x=1`, "a b"),
    );
    expect(url.origin + url.pathname).toBe("https://smith.langchain.com/sso/login/a%20b");
    expect(url.searchParams.get("redirect_to")).toBe("/oauth/consent?client_id=c&x=1");
  });

  it("reads the token's org without verifying it", () => {
    expect(tokenOrganization(tokenFor("org-1", "??>>"))).toBe("org-1");
    expect(tokenOrganization(tokenFor(null))).toBeNull();
    expect(tokenOrganization("garbage")).toBeNull();
  });

  it("navigates through a rewritten URL and settles when the page comes back", async () => {
    const assign = vi.fn();
    const navigator = redirectThrough((url) => `${url}#sso`, assign);
    const window_ = await navigator.prepare({});
    const navigated = window_.navigate({ url: "https://x.test/a", state: undefined } as never);
    expect(assign).toHaveBeenCalledWith("https://x.test/a#sso");
    window.dispatchEvent(new Event("pageshow"));
    await expect(navigated).resolves.toEqual({ url: window.location.href });
    expect(window_.close()).toBeUndefined();
    await expect(navigator.callback("https://x.test")).resolves.toBeUndefined();
  });
});

describe("userManager", () => {
  it("asks LangSmith for a refreshable token for the server, keeping it in the given storage", () => {
    const manager = userManager(APP, "https://chess.test/app/", new InMemoryWebStorage());
    expect(manager.settings).toMatchObject({
      authority: LANGSMITH_API_URL,
      client_id: "lsc_chess",
      redirect_uri: "https://chess.test/app/",
      response_type: "code",
      scope: "openid email profile offline_access",
      resource: LANGSMITH_API_URL,
      loadUserInfo: false,
      automaticSilentRenew: false,
    });
  });

  it("sends an SSO org through its login", async () => {
    const assign = vi.fn();
    const manager = userManager(
      { ...APP, ssoSlug: "acme" },
      "https://chess.test/",
      new InMemoryWebStorage(),
      assign,
    );
    const navigator = (manager as unknown as { _redirectNavigator: INavigator })._redirectNavigator;
    const handle = await navigator.prepare({});
    void handle.navigate({ url: `${LANGSMITH_API_URL}/oauth/authorize?a=1` } as never);
    expect(assign).toHaveBeenCalledWith(
      ssoSignInUrl(`${LANGSMITH_API_URL}/oauth/authorize?a=1`, "acme"),
    );
    // Without an assign of its own, it navigates the page.
    expect(() =>
      userManager({ ...APP, ssoSlug: "acme" }, "https://chess.test/", new InMemoryWebStorage()),
    ).not.toThrow();
  });
});

describe("langsmithSignIn", () => {
  it("says whether sign-in goes through SSO", () => {
    expect(signIn().langsmith.singleSignOn).toBe(false);
    expect(signIn(fakeManager(), { ...APP, ssoSlug: "acme" }).langsmith.singleSignOn).toBe(true);
  });

  it("starts from this page, coming back to its game, and can ask for the org again", async () => {
    const { langsmith, manager } = signIn();
    window.history.replaceState(null, "", "/app/?thread=t-1#x");
    await langsmith.start();
    expect(manager.signinRedirect).toHaveBeenLastCalledWith({
      state: { search: "?thread=t-1", hash: "#x" },
      prompt: undefined,
    });
    await langsmith.start({ chooseOrganization: true });
    expect(manager.signinRedirect).toHaveBeenLastCalledWith(
      expect.objectContaining({ prompt: "consent" }),
    );
  });

  it("resumes this tab's sign-in, and nothing when there is none or it can't renew", async () => {
    expect(await signIn(fakeManager(null)).langsmith.resume(at("https://chess.test/"))).toBeNull();
    const stale = user({ expired: true, refresh_token: undefined });
    expect(await signIn(fakeManager(stale)).langsmith.resume(at("https://chess.test/"))).toBeNull();
    const expiredButRenewable = user({ expired: true });
    const resumed = await signIn(fakeManager(expiredButRenewable)).langsmith.resume(
      at("https://chess.test/"),
    );
    expect(resumed).toMatchObject({
      kind: "signed-in",
      session: { kind: "oauth", email: "ada@example.com" },
      account: { email: "ada@example.com" },
    });
  });

  it("has no account to remember without an email", async () => {
    const { langsmith } = signIn(fakeManager(user({ profile: {} as User["profile"] })));
    expect(await langsmith.resume(at("https://chess.test/"))).toMatchObject({
      kind: "signed-in",
      session: { email: null },
      account: null,
    });
  });

  it("forgets a sign-in for another org and says so", async () => {
    const other = user({ access_token: tokenFor("org-2") });
    const { langsmith, manager } = signIn(fakeManager(other));
    expect(await langsmith.resume(at("https://chess.test/"))).toEqual<Resumed>({
      kind: "wrong-organization",
      email: "ada@example.com",
    });
    expect(manager.revokeTokens).toHaveBeenCalledWith(["refresh_token"]);
    expect(manager.removeUser).toHaveBeenCalled();
    const anonymous = user({ access_token: tokenFor("org-2"), profile: {} as User["profile"] });
    expect(await signIn(fakeManager(anonymous)).langsmith.resume(at("https://x.test/"))).toEqual({
      kind: "wrong-organization",
      email: null,
    });
  });

  it("finishes LangSmith's redirect once, and puts the game back in the URL", async () => {
    const manager = fakeManager();
    manager.signinRedirectCallback.mockResolvedValue(
      user({ state: { search: "?thread=t-1", hash: "#x" } }),
    );
    const { langsmith, history } = signIn(manager);
    const callback = at("https://chess.test/app/?code=c&state=s");
    const [first, second] = await Promise.all([
      langsmith.resume(callback),
      langsmith.resume(callback),
    ]);
    expect(first?.kind).toBe("signed-in");
    expect(second?.kind).toBe("signed-in");
    expect(manager.signinRedirectCallback).toHaveBeenCalledTimes(1);
    expect(manager.signinRedirectCallback).toHaveBeenCalledWith(callback.href);
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/app/?thread=t-1#x");
  });

  it("goes back to the site's root when the redirect carried no page", async () => {
    const { langsmith, history } = signIn();
    await langsmith.resume(at("https://chess.test/app/?code=c&state=s"));
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/app/");
  });

  it("clears a failed redirect from the URL and reports it", async () => {
    const manager = fakeManager();
    manager.signinRedirectCallback.mockRejectedValue(new Error("access_denied"));
    const { langsmith, history } = signIn(manager);
    await expect(langsmith.resume(at("https://chess.test/app/?error=x&state=s#h"))).rejects.toThrow(
      "access_denied",
    );
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/app/#h");
  });
});

describe("access tokens", () => {
  it("hands out the current token while it has time left", async () => {
    const { langsmith, manager } = signIn();
    const session = await signedIn(langsmith);
    expect(await session.accessToken()).toBe(tokenFor("org-1"));
    expect(manager.signinSilent).not.toHaveBeenCalled();
  });

  it("refreshes a token about to expire, once for concurrent callers", async () => {
    const manager = fakeManager(user({ expires_in: 10 }));
    const { langsmith } = signIn(manager);
    const session = await signedIn(langsmith);
    expect(await Promise.all([session.accessToken(), session.accessToken()])).toEqual([
      "renewed",
      "renewed",
    ]);
    expect(manager.signinSilent).toHaveBeenCalledTimes(1);
    manager.getUser.mockResolvedValue(user({ expires_in: undefined }));
    expect(await session.accessToken()).toBe("renewed");
    expect(manager.signinSilent).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["fails", () => Promise.reject(new Error("invalid_grant"))],
    ["comes back empty", () => Promise.resolve(null)],
  ])("sends the user back to sign in when renewal %s", async (_, renewal) => {
    const manager = fakeManager(user({ expires_in: 0 }));
    manager.signinSilent.mockImplementation(renewal as unknown as () => Promise<User>);
    const { langsmith, onExpired } = signIn(manager);
    const session = await signedIn(langsmith);
    await expect(session.accessToken()).rejects.toThrow("Your LangSmith sign-in expired");
    expect(manager.removeUser).toHaveBeenCalled();
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it("refuses once the tab's sign-in is gone", async () => {
    const manager = fakeManager();
    const { langsmith } = signIn(manager);
    const session = await signedIn(langsmith);
    manager.getUser.mockResolvedValue(null);
    await expect(session.accessToken()).rejects.toThrow("You're signed out");
  });

  it("refuses after sign-out, even mid-lookup, and revokes the refresh token", async () => {
    const manager = fakeManager();
    const { langsmith } = signIn(manager);
    const session = await signedIn(langsmith);
    let release: (u: User) => void = () => {};
    manager.getUser.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const pending = session.accessToken();
    await langsmith.signOut();
    release(user());
    await expect(pending).rejects.toThrow("You're signed out");
    await expect(session.accessToken()).rejects.toThrow("You're signed out");
    expect(manager.revokeTokens).toHaveBeenCalledWith(["refresh_token"]);
  });

  it("waits for a refresh in flight before revoking, and never uses its token", async () => {
    const manager = fakeManager(user({ expires_in: 0 }));
    let renew: (u: User) => void = () => {};
    manager.signinSilent.mockImplementation(() => new Promise((resolve) => (renew = resolve)));
    const { langsmith } = signIn(manager);
    const session = await signedIn(langsmith);
    const pending = session.accessToken();
    await vi.waitFor(() => expect(manager.signinSilent).toHaveBeenCalled());
    const signingOut = langsmith.signOut();
    expect(manager.revokeTokens).not.toHaveBeenCalled();
    renew(user({ access_token: "late" }));
    await signingOut;
    expect(manager.revokeTokens).toHaveBeenCalled();
    await expect(pending).rejects.toThrow("You're signed out");
  });

  it("signs out cleanly while a refresh that will fail is in flight", async () => {
    const manager = fakeManager(user({ expires_in: 0 }));
    let fail: (error: Error) => void = () => {};
    manager.signinSilent.mockImplementation(() => new Promise((_, reject) => (fail = reject)));
    const { langsmith, onExpired } = signIn(manager);
    const session = await signedIn(langsmith);
    const pending = session.accessToken();
    await vi.waitFor(() => expect(manager.signinSilent).toHaveBeenCalled());
    const signingOut = langsmith.signOut();
    fail(new Error("invalid_grant"));
    await signingOut;
    await expect(pending).rejects.toThrow("You're signed out");
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("forgets the tokens even when LangSmith won't revoke", async () => {
    const manager = fakeManager();
    manager.revokeTokens.mockRejectedValue(new Error("offline"));
    const { langsmith } = signIn(manager);
    await langsmith.signOut();
    expect(manager.removeUser).toHaveBeenCalled();
  });
});

describe("makeSignIn", () => {
  it("builds a LangSmith sign-in, even where the tab can't store anything", async () => {
    for (const tab of [sessionStorage, null]) {
      const langsmith = makeSignIn(APP, tab)(() => {});
      expect(langsmith.singleSignOn).toBe(false);
      await vi.waitFor(async () => expect(await langsmith.resume(window.location)).toBeNull());
    }
  });
});
