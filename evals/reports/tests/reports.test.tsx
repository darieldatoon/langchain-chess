import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { describe, expect, it } from "vite-plus/test";

// Report pages are excluded from coverage; this catches one that no longer renders.
const reports = import.meta.glob<{ default: ComponentType; title: string }>(
  "../src/experiments/*.tsx",
  { eager: true },
);

describe("reports", () => {
  it("finds at least one report", () => {
    expect(Object.keys(reports).length).toBeGreaterThan(0);
  });

  // A whole report page takes 4-6 s on a CI runner (0.2 s locally), past the 5 s default.
  it.each(Object.entries(reports))(
    "%s renders",
    (_, report) => {
      const Report = report.default;
      render(<Report />);
      expect(report.title).toBeTruthy();
      expect(screen.getAllByRole("heading").length).toBeGreaterThan(0);
    },
    30_000,
  );
});
