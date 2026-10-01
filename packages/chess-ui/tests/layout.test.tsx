import { act, render, renderHook, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { GameShell } from "../src/layout/GameShell";
import {
  allocate,
  BOARD_MIN,
  boardSize,
  EVAL_BAR,
  layoutFor,
  REVIEW_LEFT,
  stripHeight,
  WEB_LEFT,
  type Allocation,
} from "../src/layout/sizing";
import { UNMEASURED, useCoarsePointer, useContainerLayout } from "../src/layout/useContainerLayout";

const web = (width: number, height: number) =>
  layoutFor({ width, height, left: WEB_LEFT.min, evalBar: 0 });

const webAllocation = (width: number, height: number, scale = 1, coarse = false) =>
  allocate({
    layout: web(width, height),
    width,
    height,
    left: WEB_LEFT,
    evalBar: 0,
    coarse,
    scale,
  });

describe("layoutFor", () => {
  it.each([
    [320, 568, "phone"],
    [360, 740, "phone"],
    [390, 844, "phone"],
    [844, 390, "wide"],
    [799, 1000, "phone"],
    [799, 500, "wide"],
    [800, 600, "wide"],
    [1024, 768, "wide"],
    [1259, 900, "wide"],
    [1260, 900, "full"],
    [1440, 900, "full"],
  ])("web %i×%i is %s", (width, height, layout) => {
    expect(web(width, height)).toBe(layout);
  });

  it("counts the review app's games column and eval bar", () => {
    const review = (width: number, height: number) =>
      layoutFor({ width, height, left: REVIEW_LEFT.min, evalBar: EVAL_BAR.wide });
    expect(review(1100, 700)).toBe("wide");
    expect(review(1440, 900)).toBe("full");
    expect(review(500, 700)).toBe("phone");
  });
});

describe("allocate and boardSize", () => {
  it.each([
    [320, 568],
    [360, 740],
    [390, 844],
    [844, 390],
    [799, 1000],
    [800, 600],
    [1024, 768],
    [1259, 900],
    [1260, 900],
    [1440, 900],
  ])("never lets %i×%i scroll sideways", (width, height) => {
    const a = webAllocation(width, height);
    const row =
      a.left + a.board + a.table + a.evalBar + (a.table ? a.gap : 0) + (a.left ? a.gap : 0);
    expect(row).toBeLessThanOrEqual(width);
    expect(a.board).toBeGreaterThan(0);
  });

  it("fits the board to the height on full, and widens the table with what is spare", () => {
    expect(webAllocation(1440, 900)).toEqual<Allocation>({
      layout: "full",
      board: 828,
      table: 300,
      left: 280,
      evalBar: 0,
      strip: 32,
      column: 900,
      gap: 16,
    });
  });

  it("widens the first column once the table is at its widest", () => {
    const a = webAllocation(1600, 700);
    expect(a).toMatchObject({ layout: "full", board: 628, table: 400, left: 360 });
  });

  it("fits wide layouts to the height, squeezing the table under 800px", () => {
    expect(webAllocation(1024, 768)).toMatchObject({ layout: "wide", board: 696, table: 312 });
    expect(webAllocation(844, 390)).toMatchObject({ layout: "wide", board: 318 });
    expect(webAllocation(800, 600)).toMatchObject({ board: 528, table: 256 });
    expect(webAllocation(799, 500)).toMatchObject({ layout: "wide", board: 428, table: 355 });
  });

  it("takes the board-size preference, but never below the minimum", () => {
    expect(webAllocation(1024, 768, 0.6).board).toBe(417);
    expect(webAllocation(1024, 300, 0.6).board).toBe(BOARD_MIN);
  });

  it("gives a container too short for the board the minimum; it scrolls vertically", () => {
    expect(webAllocation(1024, 200)).toMatchObject({ layout: "wide", board: BOARD_MIN });
  });

  it("fills a phone's width, whatever its height", () => {
    expect(webAllocation(390, 844)).toMatchObject({
      layout: "phone",
      board: 382,
      table: 0,
      strip: 40,
    });
    expect(webAllocation(320, 568).board).toBe(312);
    expect(webAllocation(320, 568, 0.6).board).toBe(312);
  });

  it("counts the review app's eval bar, narrower on phones", () => {
    const review = allocate({
      layout: "wide",
      width: 1100,
      height: 700,
      left: null,
      evalBar: EVAL_BAR.wide,
      coarse: false,
      scale: 1,
    });
    expect(review).toMatchObject({ board: 628, evalBar: 48, left: 0 });
    const phone = allocate({
      layout: "phone",
      width: 390,
      height: 700,
      left: null,
      evalBar: EVAL_BAR.wide,
      coarse: false,
      scale: 1,
    });
    expect(phone).toMatchObject({ board: 346, evalBar: EVAL_BAR.phone });
  });

  it("never gives a board wider than its room", () => {
    const room = boardSize({
      layout: "wide",
      width: 400,
      height: 900,
      columns: [240],
      evalBar: 0,
      reserved: 72,
      scale: 1,
    });
    expect(room).toBe(144);
    expect(
      boardSize({
        layout: "phone",
        width: 4,
        height: 100,
        columns: [],
        evalBar: 0,
        reserved: 0,
        scale: 1,
      }),
    ).toBe(0);
  });

  it("widens the table on touch, so five 44px buttons fit", () => {
    expect(webAllocation(1260, 900, 1, true)).toMatchObject({
      layout: "full",
      table: 264,
      strip: 44,
    });
  });

  it("makes strips tall enough for a button on touch", () => {
    expect([
      stripHeight("full", false),
      stripHeight("phone", false),
      stripHeight("wide", true),
    ]).toEqual([32, 40, 44]);
  });
});

function allocation(layout: Allocation["layout"]): Allocation {
  return {
    layout,
    board: 300,
    table: 250,
    left: 280,
    evalBar: 48,
    strip: 32,
    column: 372,
    gap: 16,
  };
}

const slots = {
  left: <p>left</p>,
  topStrip: <p>top</p>,
  board: <p>board</p>,
  bottomStrip: <p>bottom</p>,
  evalBar: <p>eval</p>,
  table: <p>table</p>,
  underTable: <p>under table</p>,
  under: <p>under</p>,
  phoneBar: <p>bar</p>,
  phoneMoves: <p>moves</p>,
  phoneReply: <p>reply</p>,
  phoneTabs: <p>tabs</p>,
};

const slot = (name: string) => document.querySelector<HTMLElement>(`[data-slot=${name}]`);

describe("GameShell", () => {
  it("places the first column, the board with its strips, and a table as tall as them", () => {
    render(<GameShell allocation={allocation("full")} {...slots} />);
    expect(slot("left")).toHaveStyle({ width: "280px" });
    expect(slot("board")).toHaveStyle({ width: "300px", height: "300px" });
    expect(slot("top-strip")).toHaveStyle({ height: "32px" });
    expect(slot("table")).toHaveStyle({ height: "372px" });
    expect(slot("table")!.parentElement).toHaveStyle({ width: "250px" });
    expect(slot("eval-bar")).toHaveStyle({ width: "48px", height: "300px" });
    // Under the board, as wide as it.
    expect(slot("under")).toHaveStyle({ width: "300px" });
    expect(slot("under-table")!.previousElementSibling).toBe(slot("table"));
    expect(screen.queryByText("bar")).not.toBeInTheDocument();
  });

  it("drops the first column on wide and puts `under` under everything", () => {
    render(<GameShell allocation={allocation("wide")} {...slots} />);
    expect(screen.queryByText("left")).not.toBeInTheDocument();
    expect(slot("under")).not.toHaveStyle({ width: "300px" });
    expect(screen.getByText("table")).toBeInTheDocument();
    expect(slot("under-table")!.nextElementSibling).toBe(slot("under"));
  });

  it("stacks everything on phones", () => {
    render(<GameShell allocation={allocation("phone")} {...slots} />);
    const order = [
      "top",
      "board",
      "bottom",
      "bar",
      "moves",
      "reply",
      "table",
      "under table",
      "tabs",
      "under",
    ];
    const texts = [...document.querySelectorAll("p")].map((p) => p.textContent);
    expect(texts.filter((t) => order.includes(t!))).toEqual(order);
    expect(screen.queryByText("left")).not.toBeInTheDocument();
  });

  it("leaves out the slots it isn't given", () => {
    render(
      <GameShell
        allocation={allocation("phone")}
        topStrip={slots.topStrip}
        board={slots.board}
        bottomStrip={slots.bottomStrip}
      />,
    );
    expect(slot("table")).toBeNull();
    expect(slot("under-table")).toBeNull();
    expect(slot("under")).toBeNull();
    expect(slot("eval-bar")).toBeNull();
  });
});

describe("useContainerLayout", () => {
  const observers: { callback: () => void; disconnect: ReturnType<typeof vi.fn> }[] = [];
  class Observer {
    disconnect = vi.fn();
    callback: () => void;
    constructor(callback: () => void) {
      this.callback = callback;
      observers.push(this);
    }
    observe() {}
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    observers.length = 0;
  });

  function Probe({ width }: { width: number }) {
    const ref = useRef<HTMLDivElement>(null);
    const space = useContainerLayout(ref);
    return (
      <div
        ref={(el) => {
          ref.current = el;
          if (el) {
            Object.defineProperty(el, "clientWidth", { value: width, configurable: true });
            Object.defineProperty(el, "clientHeight", { value: 700, configurable: true });
          }
        }}
      >
        {space.width}×{space.height}
      </div>
    );
  }

  it("measures the container and follows its size", () => {
    vi.stubGlobal("ResizeObserver", Observer);
    const { rerender, unmount } = render(<Probe width={390} />);
    expect(screen.getByText("390×700")).toBeInTheDocument();
    rerender(<Probe width={1024} />);
    act(() => observers[0].callback());
    expect(screen.getByText("1024×700")).toBeInTheDocument();
    // The same size again changes nothing.
    act(() => observers[0].callback());
    expect(screen.getByText("1024×700")).toBeInTheDocument();
    unmount();
    expect(observers[0].disconnect).toHaveBeenCalled();
  });

  it("assumes a desktop where nothing is laid out", () => {
    vi.stubGlobal("ResizeObserver", Observer);
    render(<Probe width={0} />);
    expect(screen.getByText(`${UNMEASURED.width}×${UNMEASURED.height}`)).toBeInTheDocument();
  });

  it("measures nothing without an element", () => {
    const { result } = renderHook(() => useContainerLayout({ current: null }));
    expect(result.current).toEqual(UNMEASURED);
  });
});

describe("useCoarsePointer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("follows the primary pointer", () => {
    let listener = () => {};
    const query = {
      matches: true,
      addEventListener: (_: string, l: () => void) => {
        listener = l;
      },
      removeEventListener: vi.fn(),
    };
    vi.spyOn(window, "matchMedia").mockReturnValue(query as unknown as MediaQueryList);
    const { result, unmount } = renderHook(() => useCoarsePointer());
    expect(result.current).toBe(true);
    query.matches = false;
    act(() => listener());
    expect(result.current).toBe(false);
    unmount();
    expect(query.removeEventListener).toHaveBeenCalled();
  });
});
