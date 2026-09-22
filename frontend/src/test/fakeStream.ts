import { vi } from "vite-plus/test";

/** Shared stand-in for `useStream`; each test file installs it with `vi.mock` so it is hoisted. */
export function useStreamMock() {
  return {
    useStream: (options: Record<string, unknown>) => {
      lastOptions.current = options;
      return fake;
    },
  };
}
import type { GameState } from "../types";

export interface FakeStream {
  values: GameState;
  isLoading: boolean;
  isThreadLoading: boolean;
  error: unknown;
  submit: ReturnType<typeof vi.fn>;
}

export const fake: FakeStream = {
  values: {},
  isLoading: false,
  isThreadLoading: false,
  error: undefined,
  submit: vi.fn(),
};

export const lastOptions: { current: Record<string, unknown> | null } = { current: null };

export function resetFake(values: GameState = {}): void {
  fake.values = values;
  fake.isLoading = false;
  fake.isThreadLoading = false;
  fake.error = undefined;
  fake.submit = vi.fn(() => Promise.resolve());
  lastOptions.current = null;
}
