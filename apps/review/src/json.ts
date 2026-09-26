// Guards for decoding JSON from LangSmith, which holds whatever any project wrote. Pure.

export type Json = Record<string, unknown>;

export const isJson = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const isString = (v: unknown): v is string => typeof v === "string";
export const isSide = (v: unknown) => v === "white" || v === "black";
export const isStrings = (v: unknown) => Array.isArray(v) && v.every(isString);
/** An array whose every item passes `check`. */
export const isArrayOf = (v: unknown, check: (item: unknown) => boolean) =>
  Array.isArray(v) && v.every(check);
