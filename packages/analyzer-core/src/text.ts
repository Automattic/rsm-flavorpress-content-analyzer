import { analyzeClaims } from "./claims.js";
import { computeMetrics } from "./metrics.js";
import { prepareText } from "./preprocess.js";
import { proofreadText } from "./proofreading.js";
import { analyzeProvenanceSignals } from "./provenance.js";
import { analyzeQuality } from "./quality.js";
import { buildAnalysisSections } from "./report.js";
import { isQualityDimension } from "./dimensions.js";
import type {
  AnalysisMode,
  AnalysisGoal,
  AnalysisResult,
  AnalysisSection,
  Dimension,
  ExtractionContext,
  ProofreadIssue,
  ProofreadingResult,
  ReportProfile,
  SourceBand,
  TextAnalysisRequest,
} from "./types.js";
import { analysisGoals, analysisModes } from "./types.js";

function normalizeMode(mode: AnalysisMode | undefined): AnalysisMode {
  const selected = mode ?? "editorial";
  if (!analysisModes.includes(selected)) {
    throw new Error(`Invalid analysis mode '${selected}'. Expected one of: ${analysisModes.join(", ")}.`);
  }
  return selected;
}

function sourceBand(claims: AnalysisResult["claims"], sourceCount: number): SourceBand {
  const factualClaims = claims.filter((claim) => claim.type === "factual");
  if (factualClaims.length === 0) {
    return "not_checked";
  }
  if (sourceCount === 0) {
    return "not_checked";
  }
  const checked = factualClaims.filter((claim) => ["supported", "partially_supported", "unsupported"].includes(claim.status));
  if (checked.length === 0) {
    return "not_checked";
  }
  const supported = checked.filter((claim) => claim.status === "supported").length;
  const partial = checked.filter((claim) => claim.status === "partially_supported").length;
  const unsupported = checked.filter((claim) => claim.status === "unsupported").length;
  const inlineOnly = factualClaims.filter((claim) => claim.status === "inline_citation_only").length;
  if (unsupported === 0 && partial === 0 && inlineOnly === 0) {
    return "supported";
  }
  if (supported > 0 || partial > 0 || inlineOnly > 0) {
    return "mixed";
  }
  return "weakly_supported";
}

function summaryHeadline(args: {
  qualityBand: AnalysisResult["summary"]["qualityBand"];
  provenanceBand: AnalysisResult["summary"]["provenanceBand"];
  sourceBand: SourceBand;
}): string {
  if (args.sourceBand === "weakly_supported" || args.sourceBand === "mixed") {
    return `Quality is ${args.qualityBand}; some factual claims need source review.`;
  }
  if (args.provenanceBand === "insufficient_evidence") {
    return `Quality is ${args.qualityBand}; provenance-risk markers abstained due to limited evidence.`;
  }
  if (args.provenanceBand === "high") {
    return `Quality is ${args.qualityBand}; clustered provenance-risk markers need human review.`;
  }
  if (args.provenanceBand === "elevated") {
    return `Quality is ${args.qualityBand}; some provenance-risk markers are elevated.`;
  }
  return `Quality is ${args.qualityBand}; provenance-risk markers are low or weak.`;
}

function topFindings(dimensions: Dimension[]): string[] {
  return dimensions
    .flatMap((dimension) => dimension.findings.map((finding) => ({ dimension, finding })))
    .sort((left, right) => concernScore(right.dimension) - concernScore(left.dimension))
    .map((entry) => entry.finding)
    .slice(0, 5);
}

function concernScore(dimension: Dimension): number {
  return isQualityDimension(dimension) ? 100 - dimension.score : dimension.score;
}

function extractionAssumptions(context?: ExtractionContext): string[] {
  if (!context) {
    return [];
  }
  return (context.confidence ?? 1) < 0.5
    ? ["URL extraction confidence is low; review the source page before relying on results."]
    : [];
}

function sourceCount(input: TextAnalysisRequest): number {
  return input.metadata?.sources?.length ?? 0;
}

function goalFromPurpose(value: string | undefined): AnalysisGoal | undefined {
  const lower = value?.toLowerCase() ?? "";
  if (!lower) {
    return undefined;
  }
  if (/\b(source|claim|citation|evidence|support)\b/u.test(lower)) {
    return "source_support";
  }
  if (/\b(clarity|rewrite|readability|plain|edit)\b/u.test(lower)) {
    return "clarity_rewrite";
  }
  if (/\b(risk|integrity|provenance|safety|trust)\b/u.test(lower)) {
    return "risk_review";
  }
  if (/\b(publish|ready|approval|final)\b/u.test(lower)) {
    return "publish_ready_review";
  }
  if (/\b(triage|scan|overview|checklist)\b/u.test(lower)) {
    return "editorial_triage";
  }
  return undefined;
}

function analysisGoal(input: TextAnalysisRequest): AnalysisGoal | undefined {
  const explicit = input.metadata?.goal;
  if (explicit && analysisGoals.includes(explicit)) {
    return explicit;
  }
  return goalFromPurpose(input.metadata?.purpose);
}

function reportProfile(input: TextAnalysisRequest): ReportProfile {
  return input.options?.reportProfile ?? "full";
}

function inputSummary(
  input: TextAnalysisRequest,
  result: AnalysisResult,
  extraction?: ExtractionContext,
): AnalysisResult["inputSummary"] {
  return {
    inputType: extraction?.requestedUrl ? "url" : "text",
    requestedUrl: extraction?.requestedUrl,
    finalUrl: extraction?.finalUrl,
    title: extraction?.title,
    languageHint: input.metadata?.languageHint,
    locale: input.metadata?.locale,
    genre: input.metadata?.genre,
    audience: input.metadata?.audience,
    goal: analysisGoal(input),
    sourceCount: sourceCount(input),
    wordCount: result.context.wordCount,
    sentenceCount: result.context.sentenceCount,
    paragraphCount: result.context.paragraphCount,
  };
}

function proofreadSpans(issues: ProofreadIssue[]): AnalysisResult["spans"] {
  return issues.map((issue) => ({
    id: issue.id,
    start: issue.start,
    end: issue.end,
    label: `proofreading_${issue.kind}`,
    severity: issue.severity,
    explanation: issue.message,
    suggestion: issue.suggestions[0] ?? "Review this passage.",
  }));
}

function withSections(result: AnalysisResult): AnalysisSection[] {
  return buildAnalysisSections(result);
}

export function analyzeText(input: TextAnalysisRequest, extraction?: ExtractionContext): AnalysisResult {
  const prepared = prepareText(input.text, input.metadata);
  const proofreading =
    input.options?.includeProofreading === false
      ? disabledProofreading(prepared.detectedLanguage)
      : proofreadText(prepared, input.metadata);
  return analyzePreparedText(input, extraction, proofreading, prepared);
}

export function disabledProofreading(language: AnalysisResult["proofreading"]["language"]): ProofreadingResult {
  return {
    status: "disabled",
    language,
    providers: [],
    issues: [],
    caveats: ["Proofreading was disabled for this analysis."],
  };
}

export function analyzePreparedText(
  input: TextAnalysisRequest,
  extraction: ExtractionContext | undefined,
  proofreading: ProofreadingResult,
  prepared = prepareText(input.text, input.metadata),
): AnalysisResult {
  const mode = normalizeMode(input.mode);
  const selectedReportProfile = reportProfile(input);
  const metrics = computeMetrics(prepared);
  const provenance = analyzeProvenanceSignals(prepared, metrics, input.metadata, mode);
  const quality = analyzeQuality(prepared, metrics, input.metadata);
  const claims = analyzeClaims(prepared, input.metadata);
  const dimensions = [...provenance.dimensions, ...quality.dimensions];
  const factBand = sourceBand(claims.claims, sourceCount(input));
  const caveats = [...provenance.caveats];

  if (prepared.detectedLanguage === "unknown") {
    caveats.push("Language-specific checks are lower-confidence.");
  }
  if (prepared.mixedLanguage) {
    caveats.push("Mixed-language text can reduce confidence in language-specific markers.");
  }

  const recommendations = [
    ...quality.recommendations,
    ...claims.claims
      .filter((claim) => claim.status === "unsupported" || claim.status === "inline_citation_only" || claim.freshnessRisk)
      .slice(0, 4)
      .map((claim) =>
        `${claim.recommendedAction} Claim: ${claim.claim}`,
      ),
  ];

  const headline = summaryHeadline({
    qualityBand: quality.band,
    provenanceBand: provenance.band,
    sourceBand: factBand,
  });

  const result: AnalysisResult = {
    reportProfile: selectedReportProfile,
    inputSummary: {
      inputType: extraction?.requestedUrl ? "url" : "text",
      requestedUrl: extraction?.requestedUrl,
      finalUrl: extraction?.finalUrl,
      title: extraction?.title,
      languageHint: input.metadata?.languageHint,
      locale: input.metadata?.locale,
      genre: input.metadata?.genre,
      audience: input.metadata?.audience,
      goal: analysisGoal(input),
      sourceCount: sourceCount(input),
      wordCount: prepared.words.length,
      sentenceCount: prepared.sentences.length,
      paragraphCount: prepared.paragraphs.length,
    },
    analysisSections: [],
    scoreContributions: dimensions.flatMap((dimension) => dimension.scoreContributions),
    proofreading,
    claimReview: claims.review,
    context: {
      detectedLanguage: prepared.detectedLanguage,
      languageConfidence: prepared.languageConfidence,
      detectedGenre: prepared.detectedGenre,
      genreConfidence: prepared.genreConfidence,
      textLengthStatus: prepared.textLengthStatus,
      wordCount: prepared.words.length,
      sentenceCount: prepared.sentences.length,
      paragraphCount: prepared.paragraphs.length,
      script: prepared.script,
      mixedLanguage: prepared.mixedLanguage,
      assumptions: [...prepared.assumptions, ...extractionAssumptions(extraction)],
      extraction,
    },
    summary: {
      provenanceBand: provenance.band,
      provenanceConfidence: provenance.confidence,
      qualityBand: quality.band,
      sourceBand: factBand,
      headline,
      caveats: [...new Set(caveats)],
      keyPoints: topFindings(dimensions),
    },
    dimensions,
    spans:
      input.options?.includeSpans === false
        ? []
        : [...provenance.spans, ...quality.spans, ...claims.spans, ...proofreadSpans(proofreading.issues)],
    claims: claims.claims,
    recommendations: [...new Set(recommendations)].slice(0, 10),
    rawMetrics: mode === "research" || input.options?.includeRawMetrics || selectedReportProfile === "machine" ? metrics : undefined,
    generatedAt: new Date().toISOString(),
  };
  result.inputSummary = inputSummary(input, result, extraction);
  result.analysisSections = withSections(result);
  return result;
}
