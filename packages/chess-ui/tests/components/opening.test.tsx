import { act, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { ExportMenu } from "../../src/components/ExportMenu";
import { BoardMenu } from "../../src/components/BoardMenu";
import { OpeningHeading, OpeningMark } from "../../src/components/Opening";
import type { OpeningTable } from "../../src/openings";
import { useOpenings } from "../../src/useOpenings";
import { openMenu } from "../support/menus";
import { renderWithProviders as render } from "../support/renderApp";

const NAJDORF = { eco: "B90", name: "Sicilian Defense: Najdorf Variation", reachedIndex: 10 };

describe("OpeningHeading and OpeningMark", () => {
  it("heads the moves with the opening, in full on tap", async () => {
    const { rerender } = render(<OpeningHeading opening={NAJDORF} />);
    const title = "B90 · Sicilian Defense: Najdorf Variation";
    await userEvent.click(screen.getByRole("button", { name: title }));
    expect(screen.getByRole("dialog")).toHaveTextContent(title);
    rerender(<OpeningHeading opening={null} />);
    expect(screen.queryByLabelText("opening")).not.toBeInTheDocument();
  });

  it("marks the move that reached it, named in full on tap", async () => {
    render(<OpeningMark opening={NAJDORF} />);
    const title = "B90 · Sicilian Defense: Najdorf Variation";
    await userEvent.click(screen.getByRole("button", { name: `Opening: ${title}` }));
    expect(screen.getByRole("dialog")).toHaveTextContent(title);
  });
});

describe("ExportMenu", () => {
  it("copies, downloads and opens on Lichess; the review app has no download", async () => {
    const handlers = {
      onCopyFen: vi.fn(),
      onCopyPgn: vi.fn(),
      onDownloadPgn: vi.fn(),
      onLichess: vi.fn(),
    };
    const { rerender } = render(
      <BoardMenu onFlip={() => {}} onHelp={() => {}}>
        <ExportMenu {...handlers} />
      </BoardMenu>,
    );
    for (const name of ["Copy FEN", "Copy PGN", "Download PGN", "Analyze on Lichess"]) {
      await openMenu("Board menu");
      await userEvent.click(screen.getByRole("menuitem", { name }));
    }
    for (const handler of Object.values(handlers)) expect(handler).toHaveBeenCalledOnce();
    rerender(
      <BoardMenu onFlip={() => {}} onHelp={() => {}}>
        <ExportMenu {...handlers} onDownloadPgn={undefined} />
      </BoardMenu>,
    );
    await openMenu("Board menu");
    expect(screen.queryByRole("menuitem", { name: "Download PGN" })).not.toBeInTheDocument();
  });
});

describe("useOpenings", () => {
  it("loads the table only once a game is on screen", async () => {
    const table = { k: ["A00", "x"] as const };
    const load = vi.fn(() => Promise.resolve(table));
    const { result, rerender } = renderHook(({ active }) => useOpenings(active, load), {
      initialProps: { active: false },
    });
    expect(load).not.toHaveBeenCalled();
    rerender({ active: true });
    await act(async () => {});
    expect(result.current).toBe(table);
    rerender({ active: true });
    expect(load).toHaveBeenCalledOnce();
  });

  it("drops a load that finishes after it stopped mattering", async () => {
    let finish: (table: OpeningTable) => void = () => {};
    const load = vi.fn(() => new Promise<OpeningTable>((resolve) => (finish = resolve)));
    const { result, unmount } = renderHook(() => useOpenings(true, load));
    unmount();
    await act(async () => finish({}));
    expect(result.current).toBeNull();
  });
});
