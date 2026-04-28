import { augmentProofreadingWithLanguageTool } from "./proofreading-languagetool.js";
import { proofreadTextWithHarper } from "./proofreading-harper.js";
import { prepareText } from "./preprocess.js";
import { analyzePreparedText, disabledProofreading } from "./text.js";
import type { AnalysisResult, ExtractionContext, TextAnalysisRequest } from "./types.js";

export async function analyzeTextAsync(input: TextAnalysisRequest, extraction?: ExtractionContext): Promise<AnalysisResult> {
  const prepared = prepareText(input.text, input.metadata);
  const baseProofreading =
    input.options?.includeProofreading === false
      ? disabledProofreading(prepared.detectedLanguage)
      : await proofreadTextWithHarper(prepared, input.metadata);
  const proofreading =
    input.options?.includeProofreading === false
      ? baseProofreading
      : await augmentProofreadingWithLanguageTool(
          prepared,
          baseProofreading,
          input.options?.languageToolUrl,
          input.metadata,
        );
  return analyzePreparedText(input, extraction, proofreading, prepared);
}
