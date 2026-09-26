export {};

declare global {
  interface Window {
    /** Injected by LangSmith (or `langsmith apps dev`): the app's only way out of its sandbox. */
    langsmith: {
      call: (
        operation: string,
        args?: { params?: Record<string, string | string[]>; body?: unknown },
      ) => Promise<unknown>;
      openUrl: (url: string, options?: { newTab?: boolean }) => void;
      setData: (patch: Record<string, unknown>) => void;
      feedback: { create: (args: Record<string, unknown>) => Promise<unknown> };
    };
  }
}
