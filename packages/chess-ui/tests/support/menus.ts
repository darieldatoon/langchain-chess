import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Opens a Radix menu. Focus first: jsdom fires a window blur while the menu autofocuses, and
 * Radix closes a menu on blur unless its trigger already had focus.
 */
export async function openMenu(name: string): Promise<void> {
  const trigger = screen.getByRole("button", { name });
  trigger.focus();
  await userEvent.click(trigger);
}
