import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { downloadJson, readJson } from "../src/files";

afterEach(() => vi.restoreAllMocks());

describe("files", () => {
  it("downloads JSON under a name", async () => {
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return "blob:x";
    });
    const revoke = vi.fn();
    URL.revokeObjectURL = revoke;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    downloadJson("opponent.json", { version: 2 });
    expect(click).toHaveBeenCalledOnce();
    expect(await blobs[0].text()).toBe('{\n  "version": 2\n}\n');
    expect(revoke).toHaveBeenCalledWith("blob:x");
  });

  it("reads JSON, or says it isn't", async () => {
    expect(await readJson(new Blob(['{"k": 3}']))).toEqual({ ok: true, value: { k: 3 } });
    expect(await readJson(new Blob(["{"]))).toEqual({ ok: false, why: "That file isn't JSON." });
  });
});
