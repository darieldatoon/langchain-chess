import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { Hint } from "../../src/components/Hint";
import { ResponsiveDialog } from "../../src/components/ResponsiveDialog";
import { TOUCH_TARGET } from "../../src/touch";
import { renderWithProviders as render } from "../support/renderApp";

function open(onClose?: () => void) {
  render(
    <ResponsiveDialog
      title="New game"
      description="Pick a side."
      onClose={onClose}
      footer={<button type="button">Play</button>}
    >
      <p>Body</p>
    </ResponsiveDialog>,
  );
  return screen.getByRole("dialog", { name: "New game" });
}

describe("ResponsiveDialog", () => {
  it("lets its sheet and viewport classes win over Macaw's fixed ones", () => {
    const dialog = open();
    const classes = dialog.className.split(" ");
    // Macaw's own: a 600px width, `100vh`, and a centring transform at every width.
    for (const macaw of ["w-[37.5rem]", "max-h-[calc(100vh-2rem)]", "left-[50%]", "top-[50%]"]) {
      expect(classes).not.toContain(macaw);
    }
    for (const ours of [
      "w-screen",
      "h-[100dvh]",
      "max-h-[100dvh]",
      "translate-x-0",
      "rounded-none",
      "sm:w-[min(37.5rem,calc(100vw-1rem))]",
      "sm:max-h-[calc(100dvh-1rem)]",
      "sm:translate-x-[-50%]",
      "pt-[env(safe-area-inset-top)]",
    ]) {
      expect(classes).toContain(ours);
    }
    expect(screen.getByText("Pick a side.")).toBeInTheDocument();
  });

  it("keeps the footer outside the scrolling body", () => {
    const dialog = open();
    const body = dialog.querySelector("[data-region=body]")!;
    const footer = dialog.querySelector("[data-region=footer]")!;
    expect(body).toHaveClass("min-h-0", "flex-1", "overflow-auto");
    expect(body).toHaveTextContent("Body");
    expect(footer).toHaveClass("shrink-0", "border-t");
    expect(body.contains(footer)).toBe(false);
    const wrapper = body.parentElement!;
    expect(wrapper).toHaveClass("overflow-hidden", "p-0");
    expect(wrapper).not.toHaveClass("overflow-y-auto", "p-space-4");
  });

  it("can't be cancelled without a way back: no Close, and Esc does nothing", () => {
    const dialog = open();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes from its own touch-sized Close and from Esc", () => {
    const onClose = vi.fn();
    const dialog = open(onClose);
    const close = screen.getByRole("button", { name: "Close" });
    expect(close.className).toContain(TOUCH_TARGET);
    fireEvent.click(close);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("Hint", () => {
  it("opens on click or tap, and shows the hover tooltip only while closed", async () => {
    render(<Hint label="About k" text="How many moves System 1 hands over." />);
    const trigger = screen.getByRole("button", { name: "About k" });
    await userEvent.hover(trigger);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("How many moves");
    await userEvent.click(trigger);
    expect(screen.getByRole("dialog")).toHaveTextContent("How many moves System 1 hands over.");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("opens from the keyboard, around its own trigger content", async () => {
    render(
      <Hint label="$0.20+ (incomplete estimate)" text="Some calls were unpriced.">
        $0.20+
      </Hint>,
    );
    const trigger = screen.getByRole("button", { name: "$0.20+ (incomplete estimate)" });
    expect(trigger).toHaveTextContent("$0.20+");
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("dialog")).toHaveTextContent("Some calls were unpriced.");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.keyboard(" ");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
