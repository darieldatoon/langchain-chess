import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Api, GamesPage } from "../src/api";
import { App } from "../src/App";
import { HostTheme } from "../src/HostTheme";
import { game } from "./support/fixtures";

vi.mock("react-chessboard", async () => (await import("./support/mocks")).chessboardMock());
vi.mock("@langchain/macaw-components/LineChart", async () =>
  (await import("./support/mocks")).lineChartMock(),
);
vi.mock("@langchain/macaw-components/Select", async () =>
  (await import("./support/mocks")).selectMock(),
);

const NOW = new Date("2026-09-25T12:00:00Z");
const PROJECTS = [
  { id: "p-local", name: "langchain-chess-local" },
  { id: "p-app", name: "langchain-chess-app" },
];

function fakeApi(overrides: Partial<Api> = {}): Api & { games: ReturnType<typeof vi.fn> } {
  const pages: Record<string, GamesPage> = {
    first: { games: [game(), game({ threadId: "t-bare", values: null })], cursor: "c1" },
    c1: { games: [game({ threadId: "t-more" })], cursor: null },
  };
  return {
    projects: vi.fn().mockResolvedValue(PROJECTS),
    games: vi.fn(
      async (_p: string, _s: string, cursor?: string | null) => pages[cursor ?? "first"],
    ),
    runUrl: vi.fn().mockResolvedValue("https://smith/trace"),
    ...overrides,
  } as Api & { games: ReturnType<typeof vi.fn> };
}

function show(api: Api, openUrl = vi.fn()) {
  render(
    <HostTheme mode="dark">
      <App api={api} openUrl={openUrl} now={() => NOW} />
    </HostTheme>,
  );
  return openUrl;
}

describe("App", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads the deployment's games from the last 7 days and replays one", async () => {
    const runUrl = vi.fn().mockResolvedValue("https://smith/trace");
    const api = fakeApi({ runUrl });
    const openUrl = show(api);
    await screen.findAllByText("claude-opus-5-5 + semif-qwen3.5-4b");
    expect(api.games).toHaveBeenCalledWith("p-app", "2026-09-18T12:00:00.000Z");
    expect(screen.getByText("Pick a game")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /1-0/ })[0]);
    expect(screen.getByRole("heading", { name: "4. Qxf7#" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open trace/ }));
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith("https://smith/trace"));
    expect(runUrl).toHaveBeenCalledWith("p-app", "run-3");
  });

  it("explains a thread without a game record", async () => {
    show(fakeApi());
    fireEvent.click(await screen.findByText("No record"));
    expect(screen.getByText("No game record")).toBeInTheDocument();
  });

  it("loads more, and reloads on a new project or window", async () => {
    const api = fakeApi();
    show(api);
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getAllByText(/7 plies/)).toHaveLength(2));
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Window"), { target: { value: "30" } });
    await waitFor(() =>
      expect(api.games).toHaveBeenLastCalledWith("p-app", "2026-08-26T12:00:00.000Z"),
    );
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "p-local" } });
    await waitFor(() =>
      expect(api.games).toHaveBeenLastCalledWith("p-local", "2026-08-26T12:00:00.000Z"),
    );
    // Clearing a select changes nothing.
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Window"), { target: { value: "" } });
    expect(api.games).toHaveBeenCalledTimes(4);
  });

  it("drops an answer that arrives after its query changed", async () => {
    let resolveFirst: (page: GamesPage) => void = () => {};
    const api = fakeApi();
    api.games
      .mockImplementationOnce(() => new Promise<GamesPage>((r) => (resolveFirst = r)))
      .mockImplementationOnce(() => new Promise<GamesPage>(() => {}));
    show(api);
    await waitFor(() => expect(api.games).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Window"), { target: { value: "1" } });
    await act(async () => resolveFirst({ games: [game()], cursor: null }));
    expect(screen.queryByText("1-0")).toBeNull();
  });

  it("shows request failures", async () => {
    show(fakeApi({ projects: vi.fn().mockRejectedValue(new Error("403 Forbidden")) }));
    expect(await screen.findByText("403 Forbidden")).toBeInTheDocument();
  });

  it("shows a failed game load until the query changes, and a failed trace link", async () => {
    const api = fakeApi({ runUrl: vi.fn().mockRejectedValue("no url") });
    api.games.mockRejectedValueOnce(new Error("timed out"));
    show(api);
    expect(await screen.findByText("timed out")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Window"), { target: { value: "1" } });
    expect(screen.queryByText("timed out")).toBeNull();
    fireEvent.click((await screen.findAllByRole("button", { name: /1-0/ }))[0]);
    fireEvent.click(screen.getByRole("button", { name: /Open trace/ }));
    expect(await screen.findByText("no url")).toBeInTheDocument();
  });

  it("reports a failed load-more", async () => {
    const api = fakeApi();
    show(api);
    const more = await screen.findByRole("button", { name: "Load more" });
    api.games.mockRejectedValueOnce(new Error("more failed"));
    fireEvent.click(more);
    expect(await screen.findByText("more failed")).toBeInTheDocument();
  });

  it("waits for a project before loading anything", async () => {
    const projects = vi.fn().mockResolvedValue([]);
    const api = fakeApi({ projects });
    show(api);
    await waitFor(() => expect(projects).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Window"), { target: { value: "1" } });
    expect(api.games).not.toHaveBeenCalled();
  });
});
