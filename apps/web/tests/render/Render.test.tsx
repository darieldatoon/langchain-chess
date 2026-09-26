import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { readMessage, type Shown } from "../../src/render/messages";
import { Render } from "../../src/render/Render";
import { RenderApp } from "../../src/render/RenderApp";
import { renderWithProviders } from "../support/renderApp";
import { failed, inputs, jev, reference, semif } from "../../preview/samples";

interface Options {
  position: string;
  boardOrientation: string;
  arrows?: { startSquare: string; endSquare: string; color: string }[];
}

const board = vi.hoisted(() => ({ options: null as Options | null }));

vi.mock("react-chessboard", () => ({
  Chessboard: ({ options }: { options: Options }) => {
    board.options = options;
    return <div data-testid="board" data-position={options.position} />;
  },
  defaultPieces: {},
}));

const shown = (type: string, data: unknown) =>
  readMessage({ type, data, metadata: { inputs } }) as Shown;
const draw = (s: Shown | null, embedded = true) =>
  renderWithProviders(<Render shown={s} embedded={embedded} />);
const arrowSquares = () => board.options?.arrows?.map((a) => a.startSquare + a.endSquare);

describe("Render", () => {
  it("waits inside LangSmith, and explains itself opened on its own", () => {
    const { unmount } = draw(null);
    expect(screen.getByText("Waiting for LangSmith to send a run…")).toBeInTheDocument();
    unmount();
    draw(null, false);
    expect(screen.getByText(/custom output renderer/)).toBeInTheDocument();
  });

  it("says why it can't draw a message", () => {
    draw({ kind: "unreadable", reason: "no inputs" });
    expect(screen.getByText("Not a chess position")).toBeInTheDocument();
    expect(screen.getByText("no inputs")).toBeInTheDocument();
  });

  it("draws Stockfish's top 3 as arrows, the best on top, and every move's eval", () => {
    draw(shown("reference", reference));
    expect(board.options?.boardOrientation).toBe("white");
    expect(arrowSquares()).toEqual([...reference.top3].reverse());
    const [third, , best] = board.options!.arrows!;
    expect(third.color).toMatch(/^color-mix\(/);
    expect(best.color).not.toMatch(/color-mix/);
    expect(screen.getByText("White to move · move 13")).toBeInTheDocument();
    expect(screen.getByText("f4 -8.4")).toBeInTheDocument();
    const rows = within(screen.getByRole("table", { name: "engine evals" })).getAllByRole("row");
    expect(rows).toHaveLength(reference.ranked.length + 1);
    expect(rows[1]).toHaveTextContent("1f4-8.4");
    expect(rows[1]).toHaveClass("font-semibold");
    expect(rows[4]).not.toHaveClass("font-semibold");
  });

  it("draws System 1's picks, five at first, and its tournament", () => {
    draw(shown("output", semif));
    expect(arrowSquares()).toEqual(["b3b4", "f1a6", "b2b1"]);
    const picks = screen.getByLabelText("system 1 moves");
    expect(within(picks).getAllByRole("progressbar")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Show all 16" }));
    expect(within(picks).getAllByRole("progressbar")).toHaveLength(16);
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(within(picks).getAllByRole("progressbar")).toHaveLength(5);
    expect(screen.getByText("16 of 26 in the final")).toBeInTheDocument();
    expect(screen.getByText("Confidence").nextSibling).toHaveTextContent("24%");
    expect(screen.getByText("731 ms")).toBeInTheDocument();
  });

  it("shows a single ranking, and no button when every pick fits", () => {
    const { unmount } = draw(shown("output", jev));
    expect(screen.getByText("no")).toBeInTheDocument();
    unmount();
    draw(shown("output", { ...jev, ranked: jev.ranked.slice(0, 2), requests: null }));
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("Requests")).not.toBeInTheDocument();
  });

  it("shows a failed ranking's error, on a bare board", () => {
    draw(shown("output", failed));
    expect(screen.getByText("Ranking failed")).toBeInTheDocument();
    expect(screen.getByText(failed.error)).toBeInTheDocument();
    expect(screen.getByText("4.2 s")).toBeInTheDocument();
    expect(board.options?.arrows).toEqual([]);
  });

  it("orients the board to the side to move", () => {
    draw(
      readMessage({
        type: "reference",
        data: { evals: { e7e5: { cp: -30 } }, ranked: ["e7e5"] },
        metadata: { inputs: { ...inputs, moves: ["e2e4"], legal: ["e7e5"] } },
      }),
    );
    expect(board.options?.boardOrientation).toBe("black");
    expect(screen.getByText("e5 +0.3")).toBeInTheDocument();
  });
});

describe("RenderApp", () => {
  const own = Object.getOwnPropertyDescriptor(window, "parent")!;
  let parent: HTMLIFrameElement | null = null;

  afterEach(() => {
    parent?.remove();
    parent = null;
    Object.defineProperty(window, "parent", own);
  });

  /** Embeds this window in another, as LangSmith's iframe would. */
  function embed(): Window {
    parent = document.createElement("iframe");
    document.body.append(parent);
    const host = parent.contentWindow!;
    Object.defineProperty(window, "parent", { value: host, configurable: true });
    return host;
  }

  const post = (data: unknown, source: Window) =>
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data, source }));
    });
  const referenceMessage = { type: "reference", data: reference, metadata: { inputs } };

  it("draws what its parent sends, and ignores other windows and other messages", () => {
    const host = embed();
    renderWithProviders(<RenderApp />);
    expect(screen.getByText("Waiting for LangSmith to send a run…")).toBeInTheDocument();

    post(referenceMessage, window);
    expect(screen.queryByTestId("board")).not.toBeInTheDocument();

    post(referenceMessage, host);
    expect(screen.getByText("Stockfish")).toBeInTheDocument();

    post({ type: "something-else" }, host);
    expect(screen.getByText("Stockfish")).toBeInTheDocument();
  });

  it("ignores every message when it isn't embedded", () => {
    renderWithProviders(<RenderApp />);
    expect(screen.getByText(/custom output renderer/)).toBeInTheDocument();
    post(referenceMessage, window);
    expect(screen.queryByTestId("board")).not.toBeInTheDocument();
  });
});
