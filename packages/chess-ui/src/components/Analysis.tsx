import { lazy, Suspense } from "react";

// Markdown rendering is about a fifth of the bundle and only needed once the LLM has replied,
// so it loads on first use; until then the reply shows as plain text.
const Markdown = lazy(() => import("react-markdown"));

export function Analysis({ text }: { text: string }) {
  return (
    <Suspense fallback={<p className="whitespace-pre-wrap">{text}</p>}>
      <Markdown>{text}</Markdown>
    </Suspense>
  );
}
