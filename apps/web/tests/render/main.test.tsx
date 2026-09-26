import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../src/render/RenderApp", () => ({ RenderApp: () => <p>renderer</p> }));

describe("render/main", () => {
  it("mounts the renderer on #root, and does nothing without one", async () => {
    vi.resetModules();
    await import("../../src/render/main");
    expect(document.body.textContent).toBe("");

    const root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);
    vi.resetModules();
    await import("../../src/render/main");
    await vi.waitFor(() => expect(root.textContent).toBe("renderer"));
    root.remove();
  });
});
