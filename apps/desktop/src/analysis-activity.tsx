import { cn } from "./ui";

const ANALYSIS_BINARY_TICKER =
  "01000011 01101111 01101110 01110100 01100101 01101110 01110100 00100000 01000001 01101110 01100001 01101100 01111001 01110011 01101001 01110011 00100000 ";

export function AnalysisActivity({
  className,
  message = "Analysis is running in the background.",
}: {
  className?: string;
  message?: string;
}) {
  return (
    <div className={cn("analysis-activity", className)} role="status" aria-live="polite">
      <div className="analysis-activity__header">
        <span className="analysis-beacon" aria-hidden="true" />
        <span>{message}</span>
      </div>
      <div className="analysis-binary-strip" aria-hidden="true">
        <div className="analysis-binary-stream">{ANALYSIS_BINARY_TICKER.repeat(8)}</div>
      </div>
    </div>
  );
}
