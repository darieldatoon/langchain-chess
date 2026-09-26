import { describe, expect, it } from "vite-plus/test";
import { commandKey, createCommandIds } from "../src/commands";

describe("command ids", () => {
  it("keys by ply and content", () => {
    expect(commandKey(0, "go")).toBe("0:go");
    expect(commandKey(2, "e2e4")).toBe("2:e2e4");
  });

  it("reuses an id for the same key and mints one per new key", () => {
    let n = 0;
    const idFor = createCommandIds(() => `id-${++n}`);
    expect(idFor("a")).toBe("id-1");
    expect(idFor("a")).toBe("id-1");
    expect(idFor("b")).toBe("id-2");
    expect(createCommandIds()("a")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
