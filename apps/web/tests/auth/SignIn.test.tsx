import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import type { KeyCheck } from "../../src/auth/check";
import type { LangSmithSignIn } from "../../src/auth/oauth";
import { SignIn } from "../../src/auth/SignIn";
import type { SignInProblem } from "../../src/auth/useSession";
import { renderWithProviders as render } from "../support/renderApp";

// `start` stays pending: the page would be leaving for LangSmith.
const pending = () => vi.fn(() => new Promise<void>(() => {}));

function langsmith(overrides: Partial<LangSmithSignIn> = {}): LangSmithSignIn {
  return { singleSignOn: false, start: pending(), resume: vi.fn(), signOut: vi.fn(), ...overrides };
}

function open(
  props: {
    langsmith?: LangSmithSignIn | null;
    problem?: SignInProblem;
    lastAccount?: { email: string } | null;
    check?: KeyCheck;
  } = {},
) {
  const handlers = {
    onForgetAccount: vi.fn(),
    checkKey: vi.fn(() => Promise.resolve(props.check ?? ({ kind: "ok" } as KeyCheck))),
    onSignInWithKey: vi.fn(),
    onRetry: vi.fn(),
  };
  render(
    <SignIn
      langsmith={props.langsmith === undefined ? langsmith() : props.langsmith}
      problem={props.problem}
      lastAccount={props.lastAccount ?? null}
      {...handlers}
    />,
  );
  return handlers;
}

const button = (name: string | RegExp) => screen.getByRole("button", { name });
const keyField = () => screen.getByLabelText(/LangSmith API key/);

async function submitKey(key: string) {
  fireEvent.change(keyField(), { target: { value: key } });
  await act(async () => {
    fireEvent.submit(keyField().closest("form")!);
  });
}

describe("SignIn", () => {
  it("opens on Sign in with LangSmith, with the key behind Advanced", async () => {
    const start = pending();
    open({ langsmith: langsmith({ start }) });
    expect(screen.queryByLabelText(/LangSmith API key/)).not.toBeInTheDocument();
    await act(async () => fireEvent.click(button("Sign in with LangSmith")));
    expect(start).toHaveBeenCalledWith({ chooseOrganization: false });
    expect(button("Sign in with LangSmith")).toBeDisabled();

    fireEvent.click(button("Advanced"));
    expect(keyField()).toBeInTheDocument();
    expect(screen.getByText(/stays in this tab only/)).toBeInTheDocument();
    fireEvent.click(button("Hide advanced"));
    expect(screen.queryByLabelText(/LangSmith API key/)).not.toBeInTheDocument();
  });

  it("shows only the key where the build has no OAuth app", async () => {
    const { checkKey, onSignInWithKey } = open({ langsmith: null });
    expect(screen.queryByRole("button", { name: "Advanced" })).not.toBeInTheDocument();
    expect(button("Sign in")).toBeDisabled();
    await submitKey(" lsv2_k ");
    expect(checkKey).toHaveBeenCalledWith("lsv2_k");
    expect(onSignInWithKey).toHaveBeenCalledWith("lsv2_k");
  });

  it("keeps a key the server refuses out, and says why", async () => {
    const { onSignInWithKey } = open({
      langsmith: null,
      check: { kind: "rejected", detail: "Not this workspace." },
    });
    await submitKey("lsv2_bad");
    expect(onSignInWithKey).not.toHaveBeenCalled();
    expect(screen.getByText(/Not this workspace\./)).toBeInTheDocument();
    expect(button("Sign in")).toBeEnabled();
  });

  it.each([
    [new Error("metadata unreachable"), "metadata unreachable"],
    ["nope", "Couldn't reach LangSmith."],
  ])("reports a sign-in that can't start: %s", async (error, text) => {
    open({ langsmith: langsmith({ start: vi.fn(() => Promise.reject(error)) }) });
    await act(async () => fireEvent.click(button("Sign in with LangSmith")));
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(button("Sign in with LangSmith")).toBeEnabled();
  });

  it("offers the last account, or another one", async () => {
    const start = pending();
    const { onForgetAccount } = open({
      langsmith: langsmith({ start }),
      lastAccount: { email: "ada@example.com" },
    });
    expect(screen.getByText("Last used")).toBeInTheDocument();
    expect(screen.getByText("LangSmith")).toBeInTheDocument();
    fireEvent.click(button("Use another account"));
    expect(onForgetAccount).toHaveBeenCalled();
    await act(async () => fireEvent.click(button(/ada@example\.com/)));
    expect(start).toHaveBeenCalled();
    expect(button(/ada@example\.com/)).toHaveAttribute("aria-busy", "true");
  });

  it("names single sign-on on the last account", () => {
    open({
      langsmith: langsmith({ singleSignOn: true }),
      lastAccount: { email: "ada@example.com" },
    });
    expect(screen.getByText("Single sign-on")).toBeInTheDocument();
  });

  it("explains a sign-in for another org and asks LangSmith for the org again", async () => {
    const start = pending();
    open({
      langsmith: langsmith({ start }),
      problem: { kind: "wrong-organization", email: "ada@other.com" },
      lastAccount: { email: "ada@example.com" },
    });
    expect(screen.getByText("That account isn't in this organization")).toBeInTheDocument();
    expect(screen.getByText(/as ada@other\.com/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "smith.langchain.com" })).toBeInTheDocument();
    expect(screen.queryByText("Last used")).not.toBeInTheDocument();
    await act(async () => fireEvent.click(button("Try again")));
    expect(start).toHaveBeenCalledWith({ chooseOrganization: true });
  });

  it("points an SSO org back at its own login", () => {
    open({
      langsmith: langsmith({ singleSignOn: true }),
      problem: { kind: "wrong-organization", email: null },
    });
    expect(screen.getByText(/LangSmith signed you in for another/)).toBeInTheDocument();
    expect(screen.getByText(/single sign-on/)).toBeInTheDocument();
  });

  it("offers to check the server again after it couldn't be reached", () => {
    const { onRetry } = open({ problem: { kind: "error", message: "Couldn't reach it" } });
    expect(screen.getByText("Couldn't reach it")).toBeInTheDocument();
    fireEvent.click(button("Try again"));
    expect(onRetry).toHaveBeenCalled();
  });

  it("says an expired sign-in left the game where it was", () => {
    open({ problem: { kind: "expired" } });
    expect(screen.getByText(/continue this game/)).toBeInTheDocument();
  });
});
