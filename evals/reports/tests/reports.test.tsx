import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { describe, expect, it } from "vite-plus/test";

// Report pages are excluded from coverage; this catches one that no longer renders.
const reports = import.meta.glob<{ default: ComponentType; title: string }>(
  "../src/{experiments,tournaments}/*.tsx",
  { eager: true },
);

describe("reports", () => {
  it("finds at least one report", () => {
    expect(Object.keys(reports).length).toBeGreaterThan(0);
  });

  it.each(Object.entries(reports))("%s renders", (_, report) => {
    const Report = report.default;
    render(<Report />);
    expect(report.title).toBeTruthy();
    expect(screen.getAllByRole("heading").length).toBeGreaterThan(0);
  });
});
