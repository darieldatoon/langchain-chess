import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { AppMenu } from "../../src/components/AppMenu";
import { openMenu } from "../support/menus";
import { renderWithProviders } from "../support/renderApp";
import { ThemeToggle } from "../../src/components/ThemeToggle";

describe("ThemeToggle", () => {
  it("switches between light and dark", () => {
    renderWithProviders(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(document.documentElement).toHaveClass("dark");
    fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(document.documentElement).not.toHaveClass("dark");
  });
});

describe("AppMenu", () => {
  const choose = async (item: string) => {
    await openMenu("App menu");
    await userEvent.click(screen.getByRole("menuitem", { name: item }));
  };

  it("opens settings and switches the theme", async () => {
    const onOpenSettings = vi.fn();
    renderWithProviders(<AppMenu onOpenSettings={onOpenSettings} />);
    await choose("Switch to dark theme");
    expect(document.documentElement).toHaveClass("dark");
    await choose("Switch to light theme");
    expect(document.documentElement).not.toHaveClass("dark");
    await choose("Settings");
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });
});
