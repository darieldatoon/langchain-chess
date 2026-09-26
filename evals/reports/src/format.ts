/** A share as a percentage; a dash when there's no value. */
export function pct(value: number | null | undefined, digits = 1): string {
  return value == null ? "–" : `${(value * 100).toFixed(digits)}%`;
}

/** A number with thousands separators and a fixed number of decimals. */
export function num(value: number | null | undefined, digits = 0): string {
  return value == null
    ? "–"
    : value.toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
}

/** The difference of two shares in percentage points, e.g. "7.3". */
export function points(a: number, b: number, digits = 1): string {
  return ((a - b) * 100).toFixed(digits);
}
