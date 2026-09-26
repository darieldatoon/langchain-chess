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
/** The move the board shows, as the move list marks it. */
const current = () => document.querySelector('[aria-current="step"]')?.textContent ?? "Start";

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
  const move = {
    grade: blunder,
    san: "Nf6",
    fenBefore: "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3",
    before: { cp: 30 },
    after: { mate: 1, winner: "white" } as const,
  };

  it("shows the grade, the better move and the engine's lines, padded to the line count", () => {
    render(<GradeCard move={move} engine="Stockfish 19" lineCount={2} />);
    expect(screen.getByText("Blunder: Nf6")).toBeInTheDocument();
    expect(screen.getByText("+0.3 → #1")).toBeInTheDocument();
    expect(screen.getByText("38.4%")).toBeInTheDocument();
    expect(screen.getByText("d5")).toBeInTheDocument();
    const lines = screen.getByLabelText("engine lines");
    expect(within(lines).getByText("d5 Bxd5")).toBeInTheDocument();
    // The header plus two rows: the line and an empty one holding its place.
    expect(lines.children).toHaveLength(3);
  });

  it("keeps its rows at the start and for a best move, with dashes for what's missing", () => {
    const { rerender } = render(<GradeCard move={null} engine="Stockfish 19" lineCount={1} />);
    expect(screen.getByText("Start position")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(5);
    expect(screen.getByLabelText("engine lines").children).toHaveLength(2);
    rerender(
      <GradeCard
        move={{ ...move, grade: { ...blunder, quality: "best", lines: [] } }}
        engine="Stockfish 19"
        lineCount={0}
      />,
    );
    expect(screen.getAllByText("—")).toHaveLength(1);
    expect(screen.queryByLabelText("engine lines")).toBeNull();
    rerender(
      <GradeCard
        move={{ ...move, grade: { ...blunder, best_move: null } }}
        engine="x"
        lineCount={1}
      />,
    );
    expect(screen.getAllByText("—")).toHaveLength(1);
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
    expect(current()).toBe("Qxf7#");
    expect(screen.getByText("Checkmate, White wins. 1-0")).toBeInTheDocument();
    expect(screen.getByLabelText("engine grade")).toBeInTheDocument();
    expect(screen.getByText("Who Played It")).toBeInTheDocument();
    expect(screen.getByLabelText("evaluation 1-0")).toBeInTheDocument();
    expect(board.options?.arrows).toHaveLength(1);
  });

  it("steps through the game by button, key, graph and move list", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Previous move" }));
    expect(current()).toBe("Nf6??");
    // The blunder: the move played and the better one.
    expect(board.options?.arrows).toHaveLength(2);
    // The result stays put on every move, so nothing below it shifts.
    expect(screen.getByText("Checkmate, White wins. 1-0")).toBeInTheDocument();
    key("Home");
    expect(current()).toBe("Start");
    expect(board.options?.arrows).toEqual([]);
    expect(screen.getByRole("button", { name: "First move" })).toBeDisabled();
    key("ArrowLeft");
    expect(current()).toBe("Start");
    key("ArrowRight");
    expect(current()).toBe("e4");
    key("End");
    expect(current()).toBe("Qxf7#");
    key("a");
    expect(current()).toBe("Qxf7#");
    fireEvent.click(screen.getByRole("button", { name: "First move" }));
    fireEvent.click(screen.getByRole("button", { name: "Next move" }));
    expect(current()).toBe("e4");
    fireEvent.click(screen.getByRole("button", { name: "Last move" }));
    expect(current()).toBe("Qxf7#");
    const graph = screen.getByRole("button", { name: "White's winning chances by ply" });
    expect(graph).toHaveAttribute("data-x", "ply 3");
    expect(graph).toHaveAttribute("data-y", "50%");
    fireEvent.click(graph);
    expect(current()).toBe("Qh5");
    fireEvent.click(screen.getByRole("button", { name: "Nc6" }));
    expect(current()).toBe("Nc6");
  });

  it("ignores keys typed into a field", () => {
    renderView();
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "Home" });
    expect(current()).toBe("Qxf7#");
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

  it("copes with missing plies, turns and moves", () => {
    const root = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 5";
    const bare = game({
      review: null,
      values: values({ start_fen: root, moves: ["e7e5"], plies: undefined, turns: undefined }),
    });
    renderView(bare);
    expect(current()).toBe("e7e5");
    expect(screen.getByRole("button", { name: "e7e5" })).toBeInTheDocument();
    const once = game({
      review: null,
      values: values({ start_fen: root, moves: undefined, outcome: null }),
    });
    renderView(once);
    expect(screen.getAllByRole("button", { name: "Last move" }).at(-1)).toBeDisabled();
  });

  it("steps through a game that starts with Black to move", () => {
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
    expect(current()).toBe("Nf3");
    expect(screen.getByText("In progress")).toBeInTheDocument();
    key("ArrowLeft");
    expect(current()).toBe("e5");
  });
});
