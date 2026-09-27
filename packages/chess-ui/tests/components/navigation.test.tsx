import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { BoardControls } from "../../src/components/BoardControls";
import { usePlyCursor } from "../../src/usePlyCursor";
import { usePlyKeys } from "../../src/usePlyKeys";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

describe("BoardControls", () => {
  it("steps, jumps and flips, disabling what leads nowhere", () => {
    const onGo = vi.fn();
    const onFlip = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TooltipProvider>{children}</TooltipProvider>
    );
    const { rerender } = render(
      <BoardControls index={0} last={3} onGo={onGo} onFlip={onFlip}>
        <span>middle</span>
      </BoardControls>,
      { wrapper },
    );
    expect(screen.getByText("middle")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "First move" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous move" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next move" }));
    fireEvent.click(screen.getByRole("button", { name: "Last move" }));
    fireEvent.click(screen.getByRole("button", { name: "Flip board" }));
    expect(onGo.mock.calls).toEqual([[1], [3]]);
    expect(onFlip).toHaveBeenCalledOnce();

    rerender(<BoardControls index={3} last={3} onGo={onGo} onFlip={onFlip} />);
    expect(screen.getByRole("button", { name: "Next move" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Last move" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Previous move" }));
    fireEvent.click(screen.getByRole("button", { name: "First move" }));
    expect(onGo.mock.calls.slice(2)).toEqual([[2], [0]]);
  });
});

describe("usePlyKeys", () => {
  const press = (key: string, target: Element | Window = window) =>
    fireEvent.keyDown(target, { key });

  it("steps with the arrows and jumps with Home and End, within the game", () => {
    const onGo = vi.fn();
    const { rerender, unmount } = renderHook(({ index }) => usePlyKeys(index, 4, onGo), {
      initialProps: { index: 2 },
    });
    press("ArrowLeft");
    press("ArrowRight");
    press("Home");
    press("End");
    press("a");
    expect(onGo.mock.calls).toEqual([[1], [3], [0], [4]]);
    rerender({ index: 0 });
    press("ArrowLeft");
    rerender({ index: 4 });
    press("ArrowRight");
    expect(onGo.mock.calls.slice(4)).toEqual([[0], [4]]);
    unmount();
    press("Home");
    expect(onGo).toHaveBeenCalledTimes(6);
  });

  it("leaves typing and dialogs alone", () => {
    const onGo = vi.fn();
    renderHook(() => usePlyKeys(1, 2, onGo));
    const { container } = render(
      <>
        <input aria-label="field" />
        <div role="dialog">
          <button type="button">side</button>
        </div>
      </>,
    );
    press("Home", container.querySelector("input")!);
    press("ArrowLeft", screen.getByRole("button", { name: "side" }));
    expect(onGo).not.toHaveBeenCalled();
    press("Home", document.body);
    expect(onGo).toHaveBeenCalledWith(0);
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
  });
});
