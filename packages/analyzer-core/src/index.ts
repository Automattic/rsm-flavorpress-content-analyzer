import { analyzeTextAsync } from "./text-async.js";
import type { AnalysisRequest, AnalysisResult, UrlAnalysisRequest } from "./types.js";

export * from "./types.js";
export * from "./dimensions.js";
export { buildAnalysisSections, buildReportView, renderClaimsCsv, renderMarkdownReport } from "./report.js";
export { analyzeText } from "./text.js";
export { analyzeTextAsync } from "./text-async.js";

function hasUrl(input: AnalysisRequest): input is UrlAnalysisRequest {
  return typeof (input as UrlAnalysisRequest).url === "string";
}

export async function analyzeUrl(input: UrlAnalysisRequest): Promise<AnalysisResult> {
  const { extractTextFromUrl } = await import("./extract.js");
  const extracted = await extractTextFromUrl(input);
  return analyzeTextAsync(
    {
      ...input,
      text: extracted.text,
    },
    extracted.context,
  );
}

export async function analyze(input: AnalysisRequest): Promise<AnalysisResult> {
  return hasUrl(input) ? analyzeUrl(input) : analyzeTextAsync(input);
}
