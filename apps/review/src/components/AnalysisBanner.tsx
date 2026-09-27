import { Banner } from "@langchain/macaw-components/Banner";
import { Button } from "@langchain/macaw-components/Button";
import type { Analysis, LaunchState } from "../analysis";
import type { Grading } from "../review";

interface Props {
  threadId: string;
  grading: Grading;
  analysis: Analysis | null;
  launch: LaunchState | undefined;
  onAnalyze: () => void;
}

/** Where the game stands with the Analyze button; nothing for a graded game at rest. */
export function AnalysisBanner({ threadId, grading, analysis, launch, onAnalyze }: Props) {
  const starting = launch?.status === "starting";
  // `loading` alone leaves the button clickable, and a second click would launch twice.
  const action = (label: string) => (
    <Button
      variant="outlined"
      color="secondary"
      size="sm"
      loading={starting}
      disabled={starting}
      onClick={onAnalyze}
    >
      {label}
    </Button>
  );
  const fallback = (
    <>
      Or grade it with <code>lcchess grade --thread {threadId}</code>.
    </>
  );

  if (launch?.status === "error") {
    return (
      <Banner intent="error" title="Analysis couldn't start" action={action("Try again")}>
        {launch.message} {fallback}
      </Banner>
    );
  }
  if (launch?.status === "started" || analysis?.status === "analyzing") {
    return (
      <Banner intent="info" title="Analyzing…">
        Stockfish is grading this game in a LangSmith sandbox. Refresh the game list in a minute to
        see the grades.
      </Banner>
    );
  }
  if (analysis?.status === "stalled") {
    return (
      <Banner intent="warning" title="Analysis didn't finish" action={action("Retry")}>
        The job stopped without reporting back. {fallback}
      </Banner>
    );
  }
  if (analysis?.status === "failed") {
    return (
      <Banner intent="error" title="Analysis failed" action={action("Retry")}>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs">
          {analysis.log || "The job left no log."}
        </pre>
      </Banner>
    );
  }
  if (grading.status === "invalid") {
    return (
      <Banner intent="warning" title="Review unreadable" action={action("Re-analyze")}>
        The engine review can't be drawn: {grading.problem}. Re-analyze it, or regrade it with{" "}
        <code>lcchess grade --thread {threadId} --force</code>.
      </Banner>
    );
  }
  if (grading.status === "ungraded") {
    return (
      <Banner intent="info" title="Not graded yet" action={action("Analyze")}>
        Analyze grades it with Stockfish in a LangSmith sandbox, to show engine evaluations here.{" "}
        {fallback}
      </Banner>
    );
  }
  return null;
}
