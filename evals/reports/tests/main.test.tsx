import { screen } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it } from "vite-plus/test";

describe("main", () => {
  it("renders the report into #root and titles the page", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    await act(async () => {
      await import("../src/main");
    });
    expect(document.title).toBe("Fixture report");
    expect(await screen.findByText("fixture body")).toBeInTheDocument();
  });
});
