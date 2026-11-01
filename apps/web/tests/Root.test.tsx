import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import type { KeyCheck } from "../src/auth/check";
import type { LangSmithApp } from "../src/auth/config";
import type { Session } from "../src/auth/session";
import { makeSignIn } from "../src/auth/oauth";
import Root from "../src/Root";
import { renderWithProviders as render } from "./support/renderApp";

vi.mock("../src/App.tsx", () => ({
  default: ({ session, onSignOut }: { session: Session; onSignOut: () => void }) => (
    <div>
      <p>game as {session.kind}</p>
      <button type="button" onClick={onSignOut}>
        Sign out
      </button>
    </div>
  ),
}));

const APP: LangSmithApp = { clientId: "lsc_chess", organizationId: "org-1", ssoSlug: null };
const answering = (check: KeyCheck) => vi.fn(() => Promise.resolve(check));

describe("Root", () => {
  it("says what is wrong with a misconfigured build", () => {
    render(<Root config={{ ok: false, problem: "Set it." }} />);
    expect(screen.getByText("This build is misconfigured")).toBeInTheDocument();
    expect(screen.getByText("Set it.")).toBeInTheDocument();
  });

  it("goes straight to the game where the server takes no sign-in", async () => {
    render(<Root config={{ ok: true, app: null }} check={answering({ kind: "ok" })} />);
    expect(document.querySelector("main[aria-busy=true]")).toBeInTheDocument();
    expect(await screen.findByText("game as none")).toBeInTheDocument();
  });

  it("signs in with a key the server takes, then back out", async () => {
    const check = vi.fn((session: Session) =>
      Promise.resolve<KeyCheck>(session.kind === "none" ? { kind: "missing" } : { kind: "ok" }),
    );
    render(<Root config={{ ok: true, app: null }} check={check} tab={sessionStorage} />);
    const field = await screen.findByLabelText(/LangSmith API key/);
    fireEvent.change(field, { target: { value: "lsv2_k" } });
    await act(async () => fireEvent.submit(field.closest("form")!));
    expect(check).toHaveBeenLastCalledWith({ kind: "apiKey", apiKey: "lsv2_k" });
    expect(await screen.findByText("game as apiKey")).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Sign out" })));
    expect(await screen.findByLabelText(/LangSmith API key/)).toBeInTheDocument();
    sessionStorage.clear();
  });

  it("asks the server itself by default", async () => {
    const fetcher = vi.fn(() => Promise.resolve(new Response("[]")));
    vi.stubGlobal("fetch", fetcher);
    try {
      render(<Root config={{ ok: true, app: null }} />);
      expect(await screen.findByText("game as none")).toBeInTheDocument();
      expect(fetcher).toHaveBeenCalledWith(
        expect.stringMatching(/\/assistants\/search$/),
        expect.objectContaining({ method: "POST" }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("offers Sign in with LangSmith when the build has an OAuth app", async () => {
    const signIn = vi.fn(makeSignIn);
    render(
      <Root
        config={{ ok: true, app: APP }}
        signIn={signIn}
        check={answering({ kind: "missing" })}
      />,
    );
    expect(
      await screen.findByRole("button", { name: "Sign in with LangSmith" }),
    ).toBeInTheDocument();
    expect(signIn).toHaveBeenCalledWith(APP, expect.anything());
  });
});
