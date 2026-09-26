import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { EvalBar } from "../src/components/EvalBar";
import { GameList } from "../src/components/GameList";
import { GameView } from "../src/components/GameView";
import { GradeCard } from "../src/components/GradeCard";
import { HostTheme } from "../src/HostTheme";
import { game, review, values } from "./support/fixtures";
import { board } from "./support/mocks";

vi.mock("react-chessboard", async () => (await import("./support/mocks")).chessboardMock());
vi.mock("@langchain/macaw-components/LineChart", async () =>
  (await import("./support/mocks")).lineChartMock(),
);

const renderView = (g = game(), onOpenRun = vi.fn()) =>
  render(
    <HostTheme mode="light">
      <GameView game={g} values={g.values!} onOpenRun={onOpenRun} />
    </HostTheme>,
  );
const key = (k: string) => fireEvent.keyDown(window, { key: k });
const heading = () => screen.getByRole("heading", { level: 2, name: /\.|…|Start/ });

describe("EvalBar", () => {
  it("fills White's share from the bottom, or the top when flipped", () => {
    const { rerender, container } = render(<EvalBar value={{ cp: 0 }} flipped={false} />);
    expect(screen.getByTestId("eval-white")).toHaveStyle({ height: "50%" });
    expect(container.firstChild?.firstChild).toHaveClass("flex-col-reverse");
    rerender(<EvalBar value={{ mate: 2, winner: "black" }} flipped />);
    expect(screen.getByLabelText("evaluation -#2")).toBeInTheDocument();
    expect(container.firstChild?.firstChild).not.toHaveClass("flex-col-reverse");
  });
});

describe("GradeCard", () => {
  const blunder = review().plies[5];
  const props = {
    san: "Nf6",
    fenBefore: "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3",
    before: { cp: 30 },
    after: { mate: 1, winner: "white" } as const,
    engine: "Stockfish 19",
  };

  it("shows the grade, the better move and the engine's lines", () => {
    render(<GradeCard grade={blunder} {...props} />);
    expect(screen.getByText("Blunder")).toBeInTheDocument();
    expect(screen.getByText("+0.3 → #1")).toBeInTheDocument();
    expect(screen.getByText("38.4%")).toBeInTheDocument();
    expect(screen.getByText("d5")).toBeInTheDocument();
    expect(within(screen.getByLabelText("engine lines")).getByText("d5 Bxd5")).toBeInTheDocument();
  });

  it("leaves out the best move when it was played, and lines when there are none", () => {
    render(<GradeCard grade={{ ...blunder, quality: "best", lines: [] }} {...props} />);
    expect(screen.queryByText("Best Move")).toBeNull();
    expect(screen.queryByLabelText("engine lines")).toBeNull();
    render(<GradeCard grade={{ ...blunder, best_move: null }} {...props} />);
    expect(screen.queryByText("Best Move")).toBeNull();
  });
});

describe("GameList", () => {
  const base = {
    selected: null,
    loading: false,
    onSelect: vi.fn(),
    onMore: null,
  };

  it("lists games with their result, plies and accuracy", () => {
    const onSelect = vi.fn();
    const games = [
      game(),
      game({ threadId: "t2", review: null, values: values({ moves: ["e2e4"], outcome: null }) }),
      game({
        threadId: "t3",
        values: null,
        review: review({ accuracy: { white: 88, black: null } }),
      }),
      game({ threadId: "t4", review: review({ accuracy: { white: null, black: 70 } }) }),
    ];
    render(<GameList {...base} games={games} selected="t2" onSelect={onSelect} />);
    expect(screen.getAllByText("1-0")).toHaveLength(2);
    expect(screen.getByText("98 / 61")).toBeInTheDocument();
    expect(screen.getByText(/· 1 ply$/)).toBeInTheDocument();
    expect(screen.getAllByText(/· 7 plies$/)).toHaveLength(2);
    expect(screen.getByText("Not graded")).toBeInTheDocument();
    expect(screen.getByText("No record")).toBeInTheDocument();
    expect(screen.getByText("88 / –")).toBeInTheDocument();
    expect(screen.getByText("– / 70")).toBeInTheDocument();
    const rows = screen.getAllByRole("button");
    expect(rows[1]).toHaveAttribute("aria-current", "true");
    fireEvent.click(rows[2]);
    expect(onSelect).toHaveBeenCalledWith("t3");
  });

  it("shows loading, empty and load-more states", () => {
    const onMore = vi.fn();
    const { rerender } = render(<GameList {...base} games={[]} loading />);
    expect(screen.queryByText("No games in this window.")).toBeNull();
    rerender(<GameList {...base} games={[]} />);
    expect(screen.getByText("No games in this window.")).toBeInTheDocument();
    rerender(<GameList {...base} games={[game()]} onMore={onMore} />);
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(onMore).toHaveBeenCalled();
  });
});

describe("GameView", () => {
  it("opens on the final position with its grade, result and who played it", () => {
    renderView();
    expect(heading()).toHaveTextContent("4. Qxf7#");
    expect(screen.getByText("Checkmate, White wins. 1-0")).toBeInTheDocument();
    expect(screen.getByLabelText("engine grade")).toBeInTheDocument();
    expect(screen.getByText("Who Played It")).toBeInTheDocument();
    expect(screen.getByLabelText("evaluation 1-0")).toBeInTheDocument();
    expect(board.options?.arrows).toHaveLength(1);
  });

  it("steps through the game by button, key, graph and move list", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Previous move" }));
    expect(heading()).toHaveTextContent("3… Nf6??");
    // The blunder: the move played and the better one.
    expect(board.options?.arrows).toHaveLength(2);
    expect(screen.queryByText("Checkmate, White wins. 1-0")).toBeNull();
    key("Home");
    expect(heading()).toHaveTextContent("Start");
    expect(board.options?.arrows).toEqual([]);
    expect(screen.getByRole("button", { name: "First move" })).toBeDisabled();
    key("ArrowLeft");
    expect(heading()).toHaveTextContent("Start");
    key("ArrowRight");
    expect(heading()).toHaveTextContent("1. e4");
    key("End");
    expect(heading()).toHaveTextContent("4. Qxf7#");
    key("a");
    expect(heading()).toHaveTextContent("4. Qxf7#");
    fireEvent.click(screen.getByRole("button", { name: "First move" }));
    fireEvent.click(screen.getByRole("button", { name: "Next move" }));
    expect(heading()).toHaveTextContent("1. e4");
    fireEvent.click(screen.getByRole("button", { name: "Last move" }));
    expect(heading()).toHaveTextContent("4. Qxf7#");
    const graph = screen.getByRole("button", { name: "White's winning chances by ply" });
    expect(graph).toHaveAttribute("data-x", "ply 3");
    expect(graph).toHaveAttribute("data-y", "50%");
    fireEvent.click(graph);
    expect(heading()).toHaveTextContent("2. Qh5");
    fireEvent.click(screen.getByRole("button", { name: "Nc6" }));
    expect(heading()).toHaveTextContent("2… Nc6");
  });

  it("ignores keys typed into a field", () => {
    renderView();
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "Home" });
    expect(heading()).toHaveTextContent("4. Qxf7#");
    input.remove();
  });

  it("flips the board and opens the move's trace", () => {
    const onOpenRun = vi.fn();
    renderView(game(), onOpenRun);
    fireEvent.click(screen.getByRole("button", { name: "Flip board" }));
    expect(board.options?.boardOrientation).toBe("black");
    fireEvent.click(screen.getByRole("button", { name: "Flip board" }));
    expect(board.options?.boardOrientation).toBe("white");
    fireEvent.click(screen.getByRole("button", { name: /Open trace/ }));
    expect(onOpenRun).toHaveBeenLastCalledWith("run-3");
    key("Home");
    fireEvent.click(screen.getByRole("button", { name: /Open trace/ }));
    expect(onOpenRun).toHaveBeenLastCalledWith("run-3");
  });

  it("shows an ungraded game without engine output", () => {
    renderView(game({ review: null }));
    expect(screen.getByText("Not graded yet")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^evaluation/)).toBeNull();
    expect(screen.queryByLabelText("engine grade")).toBeNull();
  });

  it("numbers moves from a Black-to-move root, and copes with missing lists", () => {
    const root = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 5";
    const bare = game({
      review: null,
      values: values({ start_fen: root, moves: ["e7e5"], plies: undefined, turns: undefined }),
    });
    renderView(bare);
    expect(heading()).toHaveTextContent("Start");
    expect(screen.getByRole("button", { name: "e7e5" })).toBeInTheDocument();
    const once = game({
      review: null,
      values: values({ start_fen: root, moves: undefined, outcome: null }),
    });
    renderView(once);
    expect(screen.getAllByRole("button", { name: "Last move" }).at(-1)).toBeDisabled();
  });

  it("numbers Black's reply after a Black-to-move root", () => {
    const root = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 5";
    const g = game({
      review: null,
      values: values({
        start_fen: root,
        moves: ["e7e5", "g1f3"],
        plies: values()
          .plies!.slice(0, 2)
          .map((p, i) => ({ ...p, san: ["e5", "Nf3"][i] })),
        turns: undefined,
        outcome: null,
      }),
    });
    renderView(g);
    expect(heading()).toHaveTextContent("6. Nf3");
    key("ArrowLeft");
    expect(heading()).toHaveTextContent("5… e5");
  });
});
