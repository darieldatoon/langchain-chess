import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { BackToLive, BoardControls, StepButton } from "../../src/components/BoardControls";
import { BoardMenu } from "../../src/components/BoardMenu";
import { ShortcutDialog } from "../../src/components/ShortcutDialog";
import { REPEAT_DELAY_MS, REPEAT_EVERY_MS } from "../../src/repeat";
import { useGameKeys, type GameKeys } from "../../src/useGameKeys";
import { usePlyCursor } from "../../src/usePlyCursor";
import { openMenu } from "../support/menus";
import { renderWithProviders } from "../support/renderApp";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/ssr/CaretLeft";

const button = (name: string) => screen.getByRole("button", { name });

describe("BoardControls", () => {
  it("steps and jumps, disabling what leads nowhere, with the menu at its end", () => {
    const onGo = vi.fn();
    const { rerender } = renderWithProviders(
      <BoardControls index={0} last={3} onGo={onGo} menu={<span>menu</span>} />,
    );
    expect(screen.getByText("menu")).toBeInTheDocument();
    expect(button("First move")).toBeDisabled();
    expect(button("Previous move")).toBeDisabled();
    // Browsing: Last move is outlined in brand.
    expect(button("Last move")).toHaveClass("border-brand-strong");
    fireEvent.click(button("Next move"));
    fireEvent.click(button("Last move"));
    expect(onGo.mock.calls).toEqual([[1], [3]]);

    rerender(<BoardControls index={3} last={3} onGo={onGo} />);
    expect(button("Next move")).toBeDisabled();
    expect(button("Last move")).toBeDisabled();
    expect(button("Last move")).not.toHaveClass("border-brand-strong");
    fireEvent.click(button("Previous move"));
    fireEvent.click(button("First move"));
    expect(onGo.mock.calls.slice(2)).toEqual([[2], [0]]);
  });

  it("keeps only ‹ and › on phones", () => {
    renderWithProviders(<BoardControls index={1} last={3} onGo={vi.fn()} compact />);
    expect(screen.queryByRole("button", { name: "First move" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Last move" })).not.toBeInTheDocument();
    expect(button("Previous move")).toBeEnabled();
  });
});

describe("StepButton", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function step(disabled = false) {
    const onStep = vi.fn();
    const view = renderWithProviders(
      <StepButton icon={CaretLeftIcon} label="Back" disabled={disabled} onStep={onStep} />,
    );
    return { onStep, view };
  }

  it("steps once on a press, then repeats while held, and stops on release", () => {
    vi.useFakeTimers();
    const { onStep } = step();
    fireEvent.pointerDown(button("Back"), { button: 0 });
    expect(onStep).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(REPEAT_DELAY_MS - 1);
    });
    expect(onStep).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(1 + 2 * REPEAT_EVERY_MS);
    });
    expect(onStep).toHaveBeenCalledTimes(3);
    fireEvent.pointerUp(button("Back"));
    // The click that ends the press is not another step.
    fireEvent.click(button("Back"), { detail: 1 });
    act(() => {
      vi.advanceTimersByTime(5 * REPEAT_EVERY_MS);
    });
    expect(onStep).toHaveBeenCalledTimes(3);
  });

  it("steps on a keyboard click even after a cancelled press", () => {
    const { onStep } = step();
    fireEvent.pointerDown(button("Back"), { button: 0 });
    fireEvent.pointerCancel(button("Back"));
    fireEvent.click(button("Back"));
    expect(onStep).toHaveBeenCalledTimes(2);
  });

  it("steps on a keyboard click, ignores other buttons, and stops when it leads nowhere", () => {
    vi.useFakeTimers();
    const { onStep, view } = step();
    fireEvent.click(button("Back"));
    expect(onStep).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(button("Back"), { button: 2 });
    expect(onStep).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(button("Back"), { button: 0 });
    view.rerender(<StepButton icon={CaretLeftIcon} label="Back" disabled onStep={onStep} />);
    act(() => {
      vi.advanceTimersByTime(REPEAT_DELAY_MS + 5 * REPEAT_EVERY_MS);
    });
    expect(onStep).toHaveBeenCalledTimes(2);
  });
});

describe("BackToLive", () => {
  it("says where the reader is and goes back to the latest move", () => {
    const onGo = vi.fn();
    const { rerender } = renderWithProviders(
      <BackToLive index={2} last={5} over={false} onGo={onGo} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Viewing move 2");
    fireEvent.click(button("Back to live"));
    expect(onGo).toHaveBeenCalledWith(5);
    rerender(<BackToLive index={5} last={5} over={false} onGo={onGo} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("stays out of a finished game", () => {
    renderWithProviders(<BackToLive index={2} last={5} over onGo={vi.fn()} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("BoardMenu", () => {
  const choose = async (name: string | RegExp) => {
    await openMenu("Board menu");
    await userEvent.click(screen.getByRole("menuitem", { name }));
  };

  it("flips and lists the keys; phones also get first and last move", async () => {
    const onFlip = vi.fn();
    const onHelp = vi.fn();
    const onGo = vi.fn();
    const { rerender } = renderWithProviders(<BoardMenu onFlip={onFlip} onHelp={onHelp} />);
    await openMenu("Board menu");
    expect(screen.queryByRole("menuitem", { name: "First move" })).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await choose(/Flip board/);
    await choose(/Keyboard shortcuts/);
    expect(onFlip).toHaveBeenCalledOnce();
    expect(onHelp).toHaveBeenCalledOnce();

    rerender(
      <BoardMenu onFlip={onFlip} onHelp={onHelp} navigate={{ onGo, last: 9 }}>
        <span>more groups</span>
      </BoardMenu>,
    );
    await openMenu("Board menu");
    expect(screen.getByText("more groups")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await choose("First move");
    await choose("Last move");
    expect(onGo.mock.calls).toEqual([[0], [9]]);
  });
});

describe("ShortcutDialog", () => {
  it("lists every key and closes", () => {
    const onClose = vi.fn();
    renderWithProviders(<ShortcutDialog onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    for (const action of [
      "Previous move",
      "Next move",
      "First move",
      "Last move",
      "Flip the board",
    ]) {
      expect(dialog).toHaveTextContent(action);
    }
    fireEvent.click(button("Done"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("useGameKeys", () => {
  const press = (key: string, target: Element | Window = window, init: KeyboardEventInit = {}) =>
    fireEvent.keyDown(target, { key, ...init });

  function keys(overrides: Partial<GameKeys> = {}) {
    const props = { onGo: vi.fn(), onFlip: vi.fn(), onHelp: vi.fn() };
    const hook = renderHook(
      (p: Partial<GameKeys>) => useGameKeys({ index: 2, last: 4, ...props, ...p }),
      { initialProps: overrides },
    );
    return { ...props, ...hook };
  }

  it("steps, jumps, flips and asks for help, within the game", () => {
    const { onGo, onFlip, onHelp, rerender, unmount } = keys();
    for (const key of [
      "ArrowLeft",
      "k",
      "ArrowRight",
      "j",
      "Home",
      "ArrowUp",
      "End",
      "ArrowDown",
    ]) {
      press(key);
    }
    press("a");
    expect(onGo.mock.calls).toEqual([[1], [1], [3], [3], [0], [0], [4], [4]]);
    press("f");
    press("?");
    expect(onFlip).toHaveBeenCalledOnce();
    expect(onHelp).toHaveBeenCalledOnce();
    rerender({ index: 0 });
    press("ArrowLeft");
    rerender({ index: 4 });
    press("ArrowRight");
    expect(onGo.mock.calls.slice(8)).toEqual([[0], [4]]);
    unmount();
    press("Home");
    expect(onGo).toHaveBeenCalledTimes(10);
  });

  it("leaves modifiers, fields, dialogs, menus and popovers alone, and a suspended game", () => {
    const { onGo, rerender } = keys();
    const { container } = render(
      <>
        <input aria-label="field" />
        <select aria-label="pick" />
        <div contentEditable suppressContentEditableWarning>
          text
        </div>
        <div role="dialog">
          <button type="button">in dialog</button>
        </div>
        <div role="menu">
          <button type="button">in menu</button>
        </div>
        <div data-radix-popper-content-wrapper="">
          <button type="button">in popover</button>
        </div>
      </>,
    );
    press("Home", container.querySelector("input")!);
    press("Home", container.querySelector("select")!);
    press("Home", screen.getByText("text"));
    for (const name of ["in dialog", "in menu", "in popover"]) press("ArrowLeft", button(name));
    for (const modifier of ["ctrlKey", "metaKey", "altKey"])
      press("Home", window, { [modifier]: true });
    // A control that handled the key (a menu trigger opening on ArrowDown) keeps it.
    const handled = new KeyboardEvent("keydown", { key: "End", cancelable: true, bubbles: true });
    handled.preventDefault();
    window.dispatchEvent(handled);
    expect(onGo).not.toHaveBeenCalled();
    press("Home", document.body);
    expect(onGo).toHaveBeenCalledWith(0);
    rerender({ enabled: false });
    press("End", document.body);
    expect(onGo).toHaveBeenCalledTimes(1);
  });
});

describe("usePlyCursor", () => {
  it("follows the game at its end and stays on an earlier position", () => {
    const { result, rerender } = renderHook(({ last }) => usePlyCursor(last), {
      initialProps: { last: 2 },
    });
    expect(result.current).toMatchObject({ index: 2, live: true });
    rerender({ last: 3 });
    expect(result.current).toMatchObject({ index: 3, live: true });

    act(() => result.current.go(1));
    rerender({ last: 4 });
    expect(result.current).toMatchObject({ index: 1, live: false });

    act(() => result.current.go(4));
    rerender({ last: 5 });
    expect(result.current).toMatchObject({ index: 5, live: true });
    act(() => result.current.go(-3));
    expect(result.current).toMatchObject({ index: 0, live: false });
  });
});
