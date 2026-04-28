export * from "./types.js";
export * from "./dimensions.js";
export { buildAnalysisSections, buildReportView, renderClaimsCsv, renderMarkdownReport } from "./report.js";
import { analyzeText as analyzeTextSync } from "./text.js";
import type { ExtractionContext, TextAnalysisRequest } from "./types.js";

export const analyzeText = analyzeTextSync;

export async function analyzeTextAsync(input: TextAnalysisRequest, extraction?: ExtractionContext) {
  return analyzeTextSync(input, extraction);
}
