import { vi, type Mock } from "vite-plus/test";
import type { ChessValues, Message } from "../types";

/** Shared stand-in for `useStream`; each test file installs it with `vi.mock` so it is hoisted. */
export function useStreamMock() {
  return {
    useStream: (options: Record<string, unknown>) => {
      lastOptions.current = options;
      optionsLog.push(options);
      const threadId = options.threadId as string | null;
      return {
        ...fake,
        ...(threadId ? fake.threads[threadId] : undefined),
        // Late-bound so a test can swap `fake.submit` without re-rendering.
        submit: (...args: unknown[]) => fake.submit(...args),
      };
    },
  };
}

export interface FakeStreamState {
  values: ChessValues;
  messages: Message[];
  isLoading: boolean;
  isThreadLoading: boolean;
  error: unknown;
}

export interface FakeStream extends FakeStreamState {
  // Tests read submitted inputs loosely; the hook under test is what types them.
  // oxlint-disable-next-line typescript/no-explicit-any
  submit: Mock<(...args: any[]) => Promise<void>>;
  /** Per-thread overrides, so a test can hold two games apart like the real hook does. */
  threads: Record<string, Partial<FakeStreamState>>;
}

export const fake: FakeStream = {
  values: {},
  messages: [],
  isLoading: false,
  isThreadLoading: false,
  error: undefined,
  submit: vi.fn(() => Promise.resolve()),
  threads: {},
};

export const lastOptions: { current: Record<string, unknown> | null } = { current: null };
export const optionsLog: Record<string, unknown>[] = [];

export function resetFake(values: ChessValues = {}, messages: Message[] = []): void {
  fake.values = values;
  fake.messages = messages;
  fake.isLoading = false;
  fake.isThreadLoading = false;
  fake.error = undefined;
  fake.submit = vi.fn(() => Promise.resolve());
  fake.threads = {};
  lastOptions.current = null;
  optionsLog.length = 0;
}
