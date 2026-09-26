import { act, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../src/index.css?inline", () => ({ default: ".x{}" }));
vi.mock("@langchain/macaw-components/Select", async () =>
  (await import("./support/mocks")).selectMock(),
);

describe("entry", () => {
  it("mounts once, injects the stylesheet once, and follows the host's mode", async () => {
    const call = vi.fn().mockResolvedValue([]);
    const openUrl = vi.fn();
    window.langsmith = { call, openUrl, setData: vi.fn(), feedback: { create: vi.fn() } };
    const entry = await import("../src/entry");
    const root = document.createElement("div");
    document.body.appendChild(root);

    await act(async () => entry.render({}, root, { mode: "dark" }));
    expect(document.documentElement).toHaveClass("dark");
    await act(async () => entry.default.render({}, root, { mode: "light" }));
    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.head.querySelectorAll("style")).toHaveLength(1);
    expect(root.textContent).toContain("Game review");
    expect(call).toHaveBeenCalledWith("GET /api/v1/sessions", expect.anything());
  });

  it("keeps the chosen project across host updates", async () => {
    const projects = [
      { id: "p-local", name: "langchain-chess-local" },
      { id: "p-app", name: "langchain-chess-app" },
    ];
    const call = vi.fn(async (operation: string) =>
      operation === "GET /api/v1/sessions" ? projects : { items: [], next_cursor: null },
    );
    window.langsmith = { call, openUrl: vi.fn(), setData: vi.fn(), feedback: { create: vi.fn() } };
    vi.resetModules();
    const entry = await import("../src/entry");
    const root = document.createElement("div");
    document.body.appendChild(root);
    await act(async () => entry.render({}, root, { mode: "light" }));
    fireEvent.change(within(root).getByLabelText("Project"), { target: { value: "p-local" } });
    await act(async () => entry.render({}, root, { mode: "dark" }));
    expect(within(root).getByLabelText("Project")).toHaveValue("p-local");
    expect(call.mock.calls.filter(([op]) => op === "GET /api/v1/sessions")).toHaveLength(1);
  });
});
