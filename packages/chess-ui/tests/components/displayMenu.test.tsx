import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { BoardMenu } from "../../src/components/BoardMenu";
import { DisplayMenu } from "../../src/components/DisplayMenu";
import { DEFAULT_DISPLAY_PREFS, type DisplayPrefs } from "../../src/prefs";
import { openMenu } from "../support/menus";
import { renderWithProviders } from "../support/renderApp";

function Menu({
  app,
  boardSize = true,
  onChange,
}: {
  app: "web" | "review";
  boardSize?: boolean;
  onChange: (prefs: DisplayPrefs) => void;
}) {
  const [prefs, setPrefs] = useState(DEFAULT_DISPLAY_PREFS);
  return (
    <BoardMenu onFlip={() => {}} onHelp={() => {}}>
      <DisplayMenu
        prefs={prefs}
        onChange={(next) => {
          setPrefs(next);
          onChange(next);
        }}
        boardSize={boardSize}
        app={app}
      />
    </BoardMenu>
  );
}

const item = (name: string) => screen.getByRole("menuitemcheckbox", { name });

describe("DisplayMenu", () => {
  it("toggles each preference in place, keeping the menu open", async () => {
    const onChange = vi.fn();
    renderWithProviders(<Menu app="web" onChange={onChange} />);
    await openMenu("Board menu");
    expect(item("Show material")).toHaveAttribute("aria-checked", "true");
    await userEvent.click(item("Show material"));
    expect(item("Show material")).toHaveAttribute("aria-checked", "false");
    await userEvent.click(item("Wheel steps through moves"));
    await userEvent.click(item("Always promote to a queen"));
    await userEvent.click(item("Tab title on your turn"));
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_DISPLAY_PREFS,
      showMaterial: false,
      wheelSteps: true,
      autoQueen: true,
      tabTitle: false,
    });
    expect(screen.queryByRole("menuitemcheckbox", { name: "Mistake notes" })).toBeNull();
    expect(screen.getByText("Board size 100%")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
  });

  it("picks the animation and how pieces move from submenus", async () => {
    const onChange = vi.fn();
    renderWithProviders(<Menu app="review" boardSize={false} onChange={onChange} />);
    await openMenu("Board menu");
    expect(screen.queryByText(/Board size/)).toBeNull();
    expect(screen.queryByRole("menuitemcheckbox", { name: "Tab title on your turn" })).toBeNull();
    await userEvent.click(item("Mistake notes"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Animation" }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "Fast" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_DISPLAY_PREFS,
      mistakeNotes: false,
      animation: "fast",
    });
    expect(screen.getByRole("menuitemradio", { name: "Fast" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("sets how pieces move", async () => {
    const onChange = vi.fn();
    renderWithProviders(<Menu app="web" onChange={onChange} />);
    await openMenu("Board menu");
    await userEvent.click(screen.getByRole("menuitem", { name: "Moving pieces" }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "Drag only" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_DISPLAY_PREFS, moveInput: "drag" });
  });

  it("sizes the board from its slider", async () => {
    const onChange = vi.fn();
    renderWithProviders(<Menu app="web" onChange={onChange} />);
    await openMenu("Board menu");
    fireEvent.change(screen.getByRole("slider", { name: "Board size" }), {
      target: { value: "0.95" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_DISPLAY_PREFS, boardScale: 0.95 });
    expect(screen.getByText("Board size 95%")).toBeInTheDocument();
  });
});
