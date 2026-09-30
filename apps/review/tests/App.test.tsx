import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createApi, type Api, type GamesPage } from "../src/api";
import { App } from "../src/App";
import { HostTheme } from "../src/HostTheme";
import { game, review, reviewFeedback, UNGRADED, values } from "./support/fixtures";

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
    traceUrl: vi.fn().mockResolvedValue("https://smith/trace"),
    analyze: vi.fn().mockResolvedValue(undefined),
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
    const traceUrl = vi.fn().mockResolvedValue("https://smith/trace");
    const api = fakeApi({ traceUrl });
    const openUrl = show(api);
    await screen.findAllByText("claude-opus-5-5 + semif-qwen3.5-4b");
    expect(api.games).toHaveBeenCalledWith("p-app", "2026-09-18T12:00:00.000Z");
    expect(screen.getByText("Pick a game")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /1-0/ })[0]);
    expect(screen.getByRole("button", { name: "Qxf7#" })).toHaveAttribute("aria-current", "step");
    fireEvent.click(screen.getByRole("button", { name: /Open trace/ }));
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith("https://smith/trace"));
    expect(traceUrl).toHaveBeenCalledWith("p-app", {
      threadId: "thread-1",
      runId: "run-3",
      runStartTime: "2026-09-25T12:30:00Z",
    });
  });

  it("keeps the reply card's toggles from game to game", async () => {
    show(fakeApi());
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /1-0/ })).toHaveLength(2));
    const [first, second] = screen.getAllByRole("button", { name: /1-0/ });
    fireEvent.click(first);
    fireEvent.click(screen.getByRole("button", { name: "Hide top moves" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide reasoning" }));
    fireEvent.click(second);
    expect(screen.getByRole("button", { name: "Show top moves" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show reasoning" })).toBeInTheDocument();
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

  it("drops a failure that arrives after its query changed", async () => {
    let rejectFirst: (e: Error) => void = () => {};
    const api = fakeApi();
    api.games.mockImplementationOnce(() => new Promise<GamesPage>((_, r) => (rejectFirst = r)));
    show(api);
    await waitFor(() => expect(api.games).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Window"), { target: { value: "1" } });
    await act(async () => rejectFirst(new Error("stale failure")));
    expect(screen.queryByText("stale failure")).toBeNull();
  });

  it("drops a load-more that settles after the project changed", async () => {
    const pending: {
      resolve: (page: GamesPage) => void;
      reject: (e: Error) => void;
    }[] = [];
    const api = fakeApi();
    show(api);
    const more = () => {
      api.games.mockImplementationOnce(
        () => new Promise<GamesPage>((resolve, reject) => pending.push({ resolve, reject })),
      );
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    };
    await screen.findByRole("button", { name: "Load more" });
    more();
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "p-local" } });
    const loadMore = await screen.findByRole("button", { name: "Load more" });
    expect(screen.getAllByText(/7 plies/)).toHaveLength(1);
    await act(async () =>
      pending[0].resolve({ games: [game({ threadId: "t-old" })], cursor: null }),
    );
    expect(screen.getAllByText(/7 plies/)).toHaveLength(1);
    expect(loadMore).toBeInTheDocument();

    more();
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "p-app" } });
    await screen.findByRole("button", { name: "Load more" });
    await act(async () => pending[1].reject(new Error("stale failure")));
    expect(screen.queryByText("stale failure")).toBeNull();
  });

  it("draws only what LangSmith's answers can back", async () => {
    const thread = (id: string) => ({
      thread_id: id,
      count: 1,
      min_start_time: "2026-09-25T12:00:00Z",
      max_start_time: "2026-09-25T12:00:00Z",
      last_trace_id: `${id}-run`,
    });
    const run = (id: string, outputs: unknown) => ({
      id: `${id}-run`,
      trace_id: `${id}-run`,
      start_time: "",
      metadata: { policy: "llm", model: id },
      outputs,
    });
    const call = vi.fn(async (operation: string) => {
      if (operation === "GET /api/v1/sessions") return PROJECTS;
      if (operation === "POST /api/v2/threads/query") {
        return { items: [thread("not-chess"), thread("huge-multipv")], next_cursor: null };
      }
      if (operation === "POST /api/v2/runs/query") {
        return {
          items: [
            run("not-chess", { moves: [{ from: "a", to: "b" }] }),
            run("huge-multipv", values()),
          ],
        };
      }
      return [reviewFeedback("huge-multipv-run", review({ settings: { multipv: 4294967296 } }))];
    });
    show(createApi(call));
    fireEvent.click(await screen.findByText("not-chess"));
    expect(screen.getByText("No game record")).toBeInTheDocument();
    fireEvent.click(screen.getByText("huge-multipv"));
    const lines = within(screen.getByLabelText("engine lines"));
    expect(lines.getByText("Engine lines before the move")).toBeInTheDocument();
    expect(screen.getByLabelText("engine lines").children).toHaveLength(2);
  });

  it("shows request failures", async () => {
    show(fakeApi({ projects: vi.fn().mockRejectedValue(new Error("403 Forbidden")) }));
    expect(await screen.findByText("403 Forbidden")).toBeInTheDocument();
  });

  it("shows a failed game load until the query changes, and a failed trace link", async () => {
    const api = fakeApi({ traceUrl: vi.fn().mockRejectedValue("no url") });
    api.games.mockRejectedValueOnce(new Error("timed out"));
    show(api);
    expect(await screen.findByText("timed out")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Window"), { target: { value: "1" } });
    expect(screen.queryByText("timed out")).toBeNull();
    fireEvent.click((await screen.findAllByRole("button", { name: /1-0/ }))[0]);
    fireEvent.click(screen.getByRole("button", { name: /Open trace/ }));
    expect(await screen.findByText("no url")).toBeInTheDocument();
  });

  it("retries a failed first load with Refresh", async () => {
    const api = fakeApi();
    api.games.mockRejectedValueOnce(new Error("timed out"));
    show(api);
    expect(await screen.findByText("timed out")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect((await screen.findAllByRole("button", { name: /1-0/ })).length).toBeGreaterThan(0);
    expect(api.games).toHaveBeenLastCalledWith("p-app", expect.any(String));
  });

  it("reports a failed load-more", async () => {
    const api = fakeApi();
    show(api);
    const more = await screen.findByRole("button", { name: "Load more" });
    api.games.mockRejectedValueOnce(new Error("more failed"));
    fireEvent.click(more);
    expect(await screen.findByText("more failed")).toBeInTheDocument();
  });

  it("analyzes an ungraded game, then shows it analyzing", async () => {
    const analyze = vi.fn().mockResolvedValue(undefined);
    const api = fakeApi({ analyze });
    const mark = { status: "analyzing" as const, id: "m", startedAt: "2026-09-25T11:59:00Z" };
    api.games
      .mockResolvedValueOnce({ games: [game({ grading: UNGRADED })], cursor: null })
      .mockResolvedValueOnce({ games: [game({ grading: UNGRADED, mark })], cursor: null });
    show(api);
    fireEvent.click(await screen.findByText("Not graded"));
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    expect(screen.getByRole("button", { name: /Analyze/ })).toBeDisabled();
    await waitFor(() => expect(api.games).toHaveBeenCalledTimes(2));
    expect(await screen.findAllByText("Analyzing…")).toHaveLength(2);
    expect(analyze).toHaveBeenCalledWith(
      {
        projectId: "p-app",
        projectName: "langchain-chess-app",
        threadId: "thread-1",
        runId: "run-3",
        runStartTime: "2026-09-25T12:30:00Z",
      },
      { force: false, previous: null },
    );
  });

  it("forgets a started launch once the refreshed page is in", async () => {
    const analyze = vi.fn().mockResolvedValue(undefined);
    const api = fakeApi({ analyze });
    let resolve: (page: GamesPage) => void = () => {};
    api.games
      .mockResolvedValueOnce({ games: [game()], cursor: null })
      .mockImplementationOnce(() => new Promise<GamesPage>((r) => (resolve = r)));
    show(api);
    fireEvent.click((await screen.findAllByRole("button", { name: /1-0/ }))[0]);
    fireEvent.click(screen.getByRole("button", { name: "Re-analyze" }));
    expect(await screen.findByText("Analyzing…")).toBeInTheDocument();
    expect(analyze).toHaveBeenCalledWith(expect.anything(), { force: true, previous: null });
    await act(async () => resolve({ games: [game()], cursor: null }));
    expect(screen.queryByText("Analyzing…")).toBeNull();
    expect(screen.getByLabelText("engine grade")).toBeInTheDocument();
  });

  it("retries a failed analysis in place of its mark", async () => {
    const mark = { status: "failed" as const, id: "m", log: "engine died" };
    const analyze = vi.fn().mockResolvedValue(undefined);
    const api = fakeApi({ analyze });
    api.games.mockResolvedValue({ games: [game({ mark })], cursor: null });
    show(api);
    fireEvent.click(await screen.findByText("Analysis failed"));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(analyze).toHaveBeenCalledWith(expect.anything(), { force: true, previous: mark }),
    );
  });

  it("says why an analysis couldn't start", async () => {
    const api = fakeApi({ analyze: vi.fn().mockRejectedValue(new Error("No sandboxes here.")) });
    show(api);
    fireEvent.click((await screen.findAllByRole("button", { name: /1-0/ }))[0]);
    fireEvent.click(screen.getByRole("button", { name: "Re-analyze" }));
    expect(await screen.findByText("Analysis couldn't start")).toBeInTheDocument();
    expect(screen.getByText(/No sandboxes here\./)).toBeInTheDocument();
    expect(api.games).toHaveBeenCalledTimes(1);
  });

  it("refreshes the first page in place, and reports a failed refresh", async () => {
    const api = fakeApi();
    show(api);
    fireEvent.click((await screen.findAllByRole("button", { name: /1-0/ }))[0]);
    api.games.mockImplementationOnce(() => new Promise<GamesPage>(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    // The open game stays up while the page reloads.
    expect(screen.getByLabelText("game")).toBeInTheDocument();
    api.games.mockRejectedValueOnce(new Error("refresh failed"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("refresh failed")).toBeInTheDocument();
    expect(api.games).toHaveBeenCalledTimes(3);
  });

  it("reloads every loaded page on refresh, so a later game stays open and current", async () => {
    const api = fakeApi();
    show(api);
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    const rows = await screen.findAllByRole("button", { name: /1-0/ });
    fireEvent.click(rows.at(-1)!);
    expect(screen.queryByText("Not graded")).toBeNull();

    const ungraded = { games: [game({ threadId: "t-more", grading: UNGRADED })], cursor: null };
    api.games.mockImplementation(async (_p: string, _s: string, cursor?: string | null) =>
      cursor === "c1" ? ungraded : { games: [game()], cursor: "c1" },
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect((await screen.findAllByText("Not graded")).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("game")).toBeInTheDocument();
    expect(api.games).toHaveBeenLastCalledWith("p-app", expect.any(String), "c1");
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

describe("App layouts", () => {
  function sized(width: number, height: number) {
    const w = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
    const h = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(height);
    return () => {
      w.mockRestore();
      h.mockRestore();
    };
  }

  it("keeps the games in a popover when there is no room for their column", async () => {
    const restore = sized(1100, 700);
    try {
      show(fakeApi());
      const games = await screen.findByRole("button", { name: "Games" });
      expect(document.querySelector("main")).toHaveAttribute("data-layout", "wide");
      // Open until a game is picked.
      fireEvent.click((await screen.findAllByRole("button", { name: /1-0/ }))[0]);
      expect(screen.queryByRole("button", { name: /Load more/ })).not.toBeInTheDocument();
      expect(screen.getByLabelText("game")).toBeInTheDocument();
      fireEvent.click(games);
      expect(await screen.findByRole("button", { name: "Load more" })).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("shows the games inline on phones, collapsed once one is picked", async () => {
    const restore = sized(390, 800);
    try {
      show(fakeApi());
      const games = await screen.findByRole("button", { name: "Games" });
      expect(games).toHaveAttribute("aria-expanded", "true");
      fireEvent.click((await screen.findAllByRole("button", { name: /1-0/ }))[0]);
      expect(games).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
      fireEvent.click(games);
      expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
    } finally {
      restore();
    }
  });
});
