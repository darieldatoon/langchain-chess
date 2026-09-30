import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { AppMenu } from "../../src/components/AppMenu";
import { GameActions, GameOver, ResultHeadline } from "../../src/components/GameActions";
import { openMenu } from "../support/menus";
import { renderWithProviders } from "../support/renderApp";
import { ThemeToggle } from "../../src/components/ThemeToggle";

describe("ThemeToggle", () => {
  it("switches between light and dark", () => {
    renderWithProviders(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(document.documentElement).toHaveClass("dark");
    fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(document.documentElement).not.toHaveClass("dark");
  });
});

describe("AppMenu", () => {
  const choose = async (item: string) => {
    await openMenu("App menu");
    await userEvent.click(screen.getByRole("menuitem", { name: item }));
  };

  it("opens settings and switches the theme", async () => {
    const onOpenSettings = vi.fn();
    renderWithProviders(<AppMenu onOpenSettings={onOpenSettings} />);
    await choose("Switch to dark theme");
    expect(document.documentElement).toHaveClass("dark");
    await choose("Switch to light theme");
    expect(document.documentElement).not.toHaveClass("dark");
    await choose("Settings");
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });
});

describe("GameActions", () => {
  function actions(overrides: Partial<Parameters<typeof GameActions>[0]> = {}) {
    const props = {
      compact: false,
      canResign: true,
      canOfferDraw: true,
      offering: false,
      answer: null,
      onResign: vi.fn(),
      onOfferDraw: vi.fn(),
      onFlip: vi.fn(),
      ...overrides,
    };
    const view = renderWithProviders(<GameActions {...props} />);
    return { ...props, view };
  }

  it("asks before resigning, and Cancel or Esc takes it back", () => {
    const { onResign } = actions();
    fireEvent.click(screen.getByRole("button", { name: "Resign" }));
    expect(screen.getByText("Resign this game?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Resign" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resign" }));
    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Resign this game?")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resign" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm resignation" }));
    expect(onResign).toHaveBeenCalledOnce();
    expect(screen.queryByText("Resign this game?")).not.toBeInTheDocument();
  });

  it("drops a confirmation the game no longer allows", () => {
    const { view, ...props } = actions();
    fireEvent.click(screen.getByRole("button", { name: "Resign" }));
    view.rerender(<GameActions {...props} canResign={false} />);
    expect(screen.getByRole("button", { name: "Resign" })).toBeDisabled();
  });

  it("offers a draw, says so while it is in flight, and shows the answer", () => {
    const { onOfferDraw, onFlip, view, ...props } = actions();
    fireEvent.click(screen.getByRole("button", { name: "Offer draw" }));
    fireEvent.click(screen.getByRole("button", { name: "Flip" }));
    expect(onOfferDraw).toHaveBeenCalledOnce();
    expect(onFlip).toHaveBeenCalledOnce();
    view.rerender(<GameActions {...props} onOfferDraw={onOfferDraw} onFlip={onFlip} offering />);
    expect(screen.getByRole("status")).toHaveTextContent("Offering a draw…");
    expect(screen.getByRole("button", { name: "Offer draw" })).toBeDisabled();
    view.rerender(
      <GameActions {...props} onOfferDraw={onOfferDraw} onFlip={onFlip} answer="Draw declined." />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Draw declined.");
  });

  it("shows icons named by their labels on phones", () => {
    actions({ compact: true, canOfferDraw: false });
    expect(screen.getByRole("button", { name: "Offer draw" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Flip board" })).toBeInTheDocument();
    expect(screen.queryByText("Resign")).not.toBeInTheDocument();
  });
});

describe("GameOver", () => {
  it("offers a rematch first, and a new game; a game with no side only a new game", () => {
    const onRematch = vi.fn();
    const onNewGame = vi.fn();
    const { rerender } = renderWithProviders(
      <GameOver humanSide="white" onRematch={onRematch} onNewGame={onNewGame}>
        <span>more</span>
      </GameOver>,
    );
    const [first, second] = screen.getAllByRole("button");
    expect([first.textContent, second.textContent]).toEqual(["Rematch", "New game"]);
    expect(first.parentElement).toHaveClass("flex-col");
    fireEvent.click(first);
    fireEvent.click(second);
    expect(onRematch).toHaveBeenCalledOnce();
    expect(onNewGame).toHaveBeenCalledOnce();
    expect(screen.getByText("more")).toBeInTheDocument();
    rerender(<GameOver humanSide={null} onRematch={onRematch} onNewGame={onNewGame} />);
    expect(screen.queryByRole("button", { name: "Rematch" })).not.toBeInTheDocument();
  });

  it("heads the table with the result from the reader's side, then why", () => {
    renderWithProviders(
      <ResultHeadline
        outcome={{ kind: "resignation", winner: "black", reason: "resigned" }}
        humanSide="white"
      />,
    );
    expect(screen.getByLabelText("headline")).toHaveTextContent(
      "You lost · White resigned · Black wins",
    );
  });
});
