// Which layout a game screen takes, and how wide each of its columns is. Pure: the container is
// measured in useContainerLayout. Lichess's `col1`/`col2`/`col3` breakpoints, from the container
// rather than the window, because the review app runs in LangSmith's iframe. Tune only here.

export type Layout = "full" | "wide" | "phone";

export const GAP = 16;
export const PHONE_GAP = 8;
/**
 * The column beside the board; `squeeze` is its minimum under 800px, `coarse` its minimum on
 * touch, where five 44px navigation buttons and the card's padding need more.
 */
export const TABLE = { min: 240, max: 400, squeeze: 200, coarse: 264 } as const;
export const BOARD_MIN = 240;
/** The review app's eval bar; the web app has none. */
export const EVAL_BAR = { wide: 48, phone: 28 } as const;
/** A player strip's height; tall enough for a Start or Retry button on a coarse pointer. */
export const STRIP = { wide: 32, phone: 40, coarse: 44 } as const;
/** Between a strip and the board edge it is attached to. */
export const STRIP_GAP = 4;
/** The page padding on phones, each side. */
export const PHONE_PADDING = 4;

export interface Span {
  min: number;
  max: number;
}

/** The first column on `full`: the web app's Reply and Opponent cards, the review games list. */
export const WEB_LEFT: Span = { min: 280, max: 360 };
export const REVIEW_LEFT: Span = { min: 288, max: 288 };

export interface Space {
  width: number;
  height: number;
}

/** First match wins. `left` is the app's first-column minimum, `evalBar` its eval bar width. */
export function layoutFor({
  width,
  height,
  left,
  evalBar,
}: Space & { left: number; evalBar: number }): Layout {
  if (width >= 1260 && width - left - TABLE.min - evalBar - 3 * GAP >= 480) return "full";
  const table = width < 800 ? TABLE.squeeze : TABLE.min;
  if ((width >= 800 || width > height) && width - table - evalBar - 2 * GAP >= BOARD_MIN) {
    return "wide";
  }
  return "phone";
}

export function stripHeight(layout: Layout, coarse: boolean): number {
  if (coarse) return STRIP.coarse;
  return layout === "phone" ? STRIP.phone : STRIP.wide;
}

export interface BoardSizing extends Space {
  layout: Layout;
  /** The allocated widths of the other columns in the board's row: one gap each. */
  columns: readonly number[];
  /** The allocated eval bar width, 0 for none. */
  evalBar: number;
  /** Everything stacked with the board in its column: the strips and their gaps. */
  reserved: number;
  /** The board-size preference, 0.6 to 1; ignored on phones. */
  scale: number;
}

/** The board's side in px: never wider than the container, so nothing scrolls sideways. */
export function boardSize({
  layout,
  width,
  height,
  columns,
  evalBar,
  reserved,
  scale,
}: BoardSizing): number {
  if (layout === "phone") {
    const phone = width - 2 * PHONE_PADDING - evalBar - (evalBar ? PHONE_GAP : 0);
    return Math.max(0, Math.floor(phone));
  }
  const gaps = GAP * (columns.length + (evalBar ? 1 : 0));
  const room = width - columns.reduce((sum, c) => sum + c, 0) - evalBar - gaps;
  const fitted = Math.min(room, height - reserved) * scale;
  return Math.max(0, Math.floor(Math.min(room, Math.max(BOARD_MIN, fitted))));
}

export interface Allocation {
  layout: Layout;
  board: number;
  /** 0 on phones, where the table stacks at full width. */
  table: number;
  /** 0 when there is no first column. */
  left: number;
  evalBar: number;
  strip: number;
  /** The board, its strips and their gaps: how tall the table is beside it. */
  column: number;
  gap: number;
}

export interface AllocationInput extends Space {
  layout: Layout;
  /** The first column, on `full` only; null for none. */
  left: Span | null;
  /** The eval bar on `full` and `wide`; phones get the narrow one. 0 for none. */
  evalBar: number;
  coarse: boolean;
  scale: number;
}

/**
 * The board first, from the minimum columns, then whatever is spare widens the table and then
 * the first column up to their maximums. What is left after that is margin.
 */
export function allocate({
  layout,
  width,
  height,
  left,
  evalBar,
  coarse,
  scale,
}: AllocationInput): Allocation {
  const strip = stripHeight(layout, coarse);
  const reserved = 2 * strip + 2 * STRIP_GAP;
  if (layout === "phone") {
    const bar = evalBar ? EVAL_BAR.phone : 0;
    const board = boardSize({ layout, width, height, columns: [], evalBar: bar, reserved, scale });
    return {
      layout,
      board,
      table: 0,
      left: 0,
      evalBar: bar,
      strip,
      column: board + reserved,
      gap: PHONE_GAP,
    };
  }
  const first = layout === "full" && left ? left : null;
  let leftWidth = first?.min ?? 0;
  let table: number = coarse ? TABLE.coarse : width < 800 ? TABLE.squeeze : TABLE.min;
  const columns = first ? [leftWidth, table] : [table];
  const board = boardSize({ layout, width, height, columns, evalBar, reserved, scale });
  let spare =
    width - board - evalBar - leftWidth - table - GAP * (columns.length + (evalBar ? 1 : 0));
  const grow = (current: number, max: number) => {
    const by = Math.max(0, Math.min(spare, max - current));
    spare -= by;
    return current + by;
  };
  table = grow(table, TABLE.max);
  if (first) leftWidth = grow(leftWidth, first.max);
  return {
    layout,
    board,
    table,
    left: leftWidth,
    evalBar,
    strip,
    column: board + reserved,
    gap: GAP,
  };
}
