import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { KeyCheck } from "../../src/auth/check";
import type { LangSmithSignIn, OAuthSession, Resumed } from "../../src/auth/oauth";
import { NO_SESSION } from "../../src/auth/session";
import { API_KEY_KEY, LAST_ACCOUNT_KEY, LEGACY_APP_KEY } from "../../src/auth/stored";
import { useSession, type SessionDeps } from "../../src/auth/useSession";

const OAUTH: OAuthSession = {
  kind: "oauth",
  email: "ada@example.com",
  accessToken: () => Promise.resolve("t"),
};

function fakeSignIn(resume: () => Promise<Resumed | null>) {
  const expired = { current: () => {} };
  const resumes = vi.fn(resume);
  const signsOut = vi.fn(() => Promise.resolve());
  const langsmith: LangSmithSignIn = {
    singleSignOn: false,
    start: vi.fn(() => Promise.resolve()),
    resume: resumes,
    signOut: signsOut,
  };
  const makeSignIn = (onExpired: () => void) => {
    expired.current = onExpired;
    return langsmith;
  };
  return { resumes, signsOut, makeSignIn, expired };
}

function setup(overrides: Partial<SessionDeps> = {}, check: KeyCheck = { kind: "ok" }) {
  const deps: SessionDeps = {
    makeSignIn: null,
    check: vi.fn(() => Promise.resolve(check)),
    tab: sessionStorage,
    local: localStorage,
    ...overrides,
  };
  return { deps, ...renderHook(() => useSession(deps)) };
}

afterEach(() => {
  sessionStorage.clear();
});

describe("useSession", () => {
  it("needs no sign-in where the server takes none, and drops a key older versions kept", async () => {
    localStorage.setItem(LEGACY_APP_KEY, '{"apiKey":"lsv2_old"}');
    const { result, deps } = setup();
    expect(result.current.state).toEqual({ status: "checking" });
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "signed-in", session: NO_SESSION }),
    );
    expect(deps.check).toHaveBeenCalledWith(NO_SESSION);
    expect(localStorage.getItem(LEGACY_APP_KEY)).toBeNull();
    expect(result.current.langsmith).toBeNull();
  });

  it("asks for a sign-in where the server wants one", async () => {
    const { result } = setup({}, { kind: "missing" });
    await waitFor(() => expect(result.current.state).toEqual({ status: "signed-out" }));
  });

  it("says when the server can't be reached, and checks again on retry", async () => {
    const check = vi.fn<SessionDeps["check"]>(() =>
      Promise.resolve({ kind: "unreachable", message: "Failed to fetch" }),
    );
    const { result } = setup({ check });
    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "signed-out",
        problem: { kind: "error", message: "Couldn't reach the server: Failed to fetch" },
      }),
    );
    check.mockResolvedValue({ kind: "ok" });
    act(() => result.current.retry());
    expect(result.current.state).toEqual({ status: "checking" });
    await waitFor(() => expect(result.current.state.status).toBe("signed-in"));
  });

  it("goes on with this tab's API key without asking the server", async () => {
    sessionStorage.setItem(API_KEY_KEY, "lsv2_k");
    const { result, deps } = setup();
    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "signed-in",
        session: { kind: "apiKey", apiKey: "lsv2_k" },
      }),
    );
    expect(deps.check).not.toHaveBeenCalled();
  });

  it("signs in with a key for this tab only, and signs out of it", async () => {
    const { result } = setup({}, { kind: "missing" });
    await waitFor(() => expect(result.current.state.status).toBe("signed-out"));
    act(() => result.current.signInWithKey(" lsv2_k "));
    expect(result.current.state).toEqual({
      status: "signed-in",
      session: { kind: "apiKey", apiKey: "lsv2_k" },
    });
    expect(sessionStorage.getItem(API_KEY_KEY)).toBe("lsv2_k");
    await act(() => result.current.signOut());
    expect(result.current.state).toEqual({ status: "signed-out" });
    expect(sessionStorage.getItem(API_KEY_KEY)).toBeNull();
  });

  it("resumes a LangSmith sign-in first, remembering the account", async () => {
    sessionStorage.setItem(API_KEY_KEY, "lsv2_k");
    const { resumes, signsOut, makeSignIn } = fakeSignIn(() =>
      Promise.resolve({ kind: "signed-in", session: OAUTH, account: { email: "ada@example.com" } }),
    );
    const { result } = setup({ makeSignIn });
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "signed-in", session: OAUTH }),
    );
    expect(resumes).toHaveBeenCalledWith(window.location);
    expect(result.current.lastAccount).toEqual({ email: "ada@example.com" });
    expect(JSON.parse(localStorage.getItem(LAST_ACCOUNT_KEY)!)).toEqual({
      email: "ada@example.com",
    });

    await act(() => result.current.signOut());
    expect(signsOut).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ status: "signed-out" });
    act(() => result.current.forgetAccount());
    expect(result.current.lastAccount).toBeNull();
    expect(localStorage.getItem(LAST_ACCOUNT_KEY)).toBeNull();
  });

  it("remembers no account for a sign-in without an email", async () => {
    const { makeSignIn } = fakeSignIn(() =>
      Promise.resolve({ kind: "signed-in", session: { ...OAUTH, email: null }, account: null }),
    );
    const { result } = setup({ makeSignIn });
    await waitFor(() => expect(result.current.state.status).toBe("signed-in"));
    expect(result.current.lastAccount).toBeNull();
  });

  it("falls back to a key or the server's check when LangSmith has no sign-in", async () => {
    const { makeSignIn } = fakeSignIn(() => Promise.resolve(null));
    const { result } = setup({ makeSignIn });
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "signed-in", session: NO_SESSION }),
    );
  });

  it("explains a sign-in for another org", async () => {
    const { makeSignIn } = fakeSignIn(() =>
      Promise.resolve({ kind: "wrong-organization", email: "ada@other.com" }),
    );
    const { result } = setup({ makeSignIn });
    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "signed-out",
        problem: { kind: "wrong-organization", email: "ada@other.com" },
      }),
    );
  });

  it.each([
    [new Error("access_denied"), "access_denied"],
    ["offline", "offline"],
  ])("reports a failed sign-in: %s", async (error, message) => {
    const { makeSignIn } = fakeSignIn(() => Promise.reject(error));
    const { result } = setup({ makeSignIn });
    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "signed-out",
        problem: { kind: "error", message },
      }),
    );
  });

  it("sends the user back to sign in when the session expires", async () => {
    const { makeSignIn, expired } = fakeSignIn(() =>
      Promise.resolve({ kind: "signed-in", session: OAUTH, account: null }),
    );
    const { result } = setup({ makeSignIn });
    await waitFor(() => expect(result.current.state.status).toBe("signed-in"));
    act(() => expired.current());
    expect(result.current.state).toEqual({ status: "signed-out", problem: { kind: "expired" } });
  });

  it("drops a check that answers after unmount", async () => {
    let answer: (check: KeyCheck) => void = () => {};
    const check = vi.fn(() => new Promise<KeyCheck>((resolve) => (answer = resolve)));
    const { result, unmount } = setup({ check });
    await waitFor(() => expect(check).toHaveBeenCalled());
    unmount();
    await act(async () => answer({ kind: "ok" }));
    expect(result.current.state).toEqual({ status: "checking" });
  });
});
