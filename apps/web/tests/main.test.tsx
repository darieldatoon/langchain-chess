import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../src/Root.tsx", () => ({ default: () => <p>app</p> }));

describe("main", () => {
  it("does nothing without #root, and mounts the app when it exists", async () => {
    vi.resetModules();
    const without = await import("../src/main.tsx");
    expect(document.body.textContent).toBe("");

    const root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);
    without.mount(root);
    await vi.waitFor(() => expect(root.textContent).toBe("app"));
    root.remove();

    const second = document.createElement("div");
    second.id = "root";
    document.body.appendChild(second);
    vi.resetModules();
    await import("../src/main.tsx");
    await vi.waitFor(() => expect(second.textContent).toBe("app"));
    second.remove();
  });
});
