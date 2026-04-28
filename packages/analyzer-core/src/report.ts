import type {
  AnalysisGoal,
  AnalysisResult,
  AnalysisSection,
  AnalysisSectionItem,
  Dimension,
  ReportProfile,
  Severity,
} from "./types.js";
import { dimensionKind, isProvenanceDimension, isQualityDimension } from "./dimensions.js";

export interface ReportView {
  profile: ReportProfile;
  title: string;
  generatedAt: string;
  headline: string;
  sections: AnalysisSection[];
}

function percent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function compactLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function readableGoal(goal: AnalysisGoal | undefined): string {
  return goal ? compactLabel(goal) : "balanced review";
}

function severityForScore(score: number, inverted = false): Severity {
  const value = inverted ? 100 - score : score;
  if (value >= 72) {
    return "high";
  }
  if (value >= 45) {
    return "medium";
  }
  return "low";
}

function topDimensionItems(dimensions: Dimension[], inverted = false, limit = 8): AnalysisSectionItem[] {
  return dimensions
    .filter((dimension) => dimension.findings.length > 0)
    .sort((left, right) => (inverted ? left.score - right.score : right.score - left.score))
    .slice(0, limit)
    .map((dimension) => ({
      id: dimension.id,
      title: dimension.label,
      body: dimension.findings[0],
      severity: severityForScore(dimension.score, inverted),
      score: dimension.score,
      metadata: {
        confidence: percent(dimension.confidence),
        metrics: dimension.metricIds.slice(0, 4).join(", "),
      },
    }));
}

function claimActionTitle(result: AnalysisResult): string {
  const goal = result.inputSummary.goal;
  if (goal === "source_support") {
    return "Add source support";
  }
  if (goal === "risk_review") {
    return "Review high-risk claim";
  }
  return "Resolve claim support";
}

function dimensionActionTitle(dimension: Dimension): string {
  if (dimension.id === "specificity") {
    return "Make this more concrete";
  }
  if (dimension.id === "depth") {
    return "Add reasoning depth";
  }
  if (dimension.id === "structure") {
    return "Improve scan structure";
  }
  if (dimension.id === "actionability") {
    return "Clarify the next step";
  }
  if (dimension.id === "readability" || dimension.id === "readability_formula") {
    return "Improve readability";
  }
  return `Improve ${dimension.label.toLowerCase()}`;
}

function supportNeedRank(value: string | undefined): number {
  if (value === "essential") {
    return 4;
  }
  if (value === "important") {
    return 3;
  }
  if (value === "recommended") {
    return 2;
  }
  return 0;
}

function severityRank(value: Severity | undefined): number {
  if (value === "high") {
    return 3;
  }
  if (value === "medium") {
    return 2;
  }
  if (value === "low") {
    return 1;
  }
  return 0;
}

function actionWeight(item: AnalysisSectionItem, goal: AnalysisGoal | undefined): number {
  const kind = String(item.metadata?.kind ?? "");
  const severity = severityRank(item.severity);
  const supportNeed = supportNeedRank(typeof item.metadata?.supportNeed === "string" ? item.metadata.supportNeed : undefined);
  const score =
    typeof item.score === "number"
      ? kind === "provenance"
        ? Math.max(0, item.score) / 10
        : Math.max(0, 100 - item.score) / 10
      : 0;
  const base = severity * 10 + supportNeed * 14 + score;

  if (goal === "source_support") {
    return base + (kind === "claim" ? 90 : kind === "proofreading" ? 8 : 15);
  }
  if (goal === "clarity_rewrite") {
    return base + (kind === "proofreading" ? 120 : kind === "quality" ? 90 : kind === "claim" ? 0 : 10);
  }
  if (goal === "risk_review") {
    return base + (kind === "claim" ? 75 : kind === "provenance" ? 72 : kind === "quality" ? 20 : 10);
  }
  if (goal === "publish_ready_review") {
    return base + (kind === "claim" ? 70 : kind === "proofreading" ? 55 : kind === "quality" ? 45 : 25);
  }
  return base + (kind === "claim" ? 55 : kind === "quality" ? 45 : kind === "proofreading" ? 35 : 30);
}

function topActions(result: AnalysisResult): AnalysisSectionItem[] {
  const claimActions = result.claims
    .filter((claim) => claim.supportNeed !== "none" || claim.status === "unsupported" || claim.status === "inline_citation_only" || claim.freshnessRisk)
    .map((claim) => ({
      id: `claim-action-${claim.id}`,
      title: claimActionTitle(result),
      body: `${claim.recommendedAction} Claim: ${claim.claim}`,
      severity: claim.importance,
      status: compactLabel(claim.status),
      metadata: {
        kind: "claim",
        supportNeed: claim.supportNeed,
        gaps: claim.supportGaps.slice(0, 2).join(" | "),
      },
    })) satisfies AnalysisSectionItem[];

  const proofreadActions = result.proofreading.issues
    .filter((issue) => issue.severity !== "low")
    .slice(0, 4)
    .map((issue) => ({
      id: `proofreading-action-${issue.id}`,
      title: `Fix ${issue.kind}`,
      body: issue.suggestions[0] ? `${issue.message} Suggested replacement: ${issue.suggestions[0]}.` : issue.message,
      severity: issue.severity,
      status: issue.source,
      metadata: {
        kind: "proofreading",
        confidence: percent(issue.confidence),
      },
    })) satisfies AnalysisSectionItem[];

  const dimensionActions = result.dimensions
    .filter((dimension) => dimension.findings.length > 0 && dimension.recommendations.length > 0)
    .map((dimension) => {
      const kind = dimensionKind(dimension);
      return {
        id: `dimension-action-${dimension.id}`,
        title: dimensionActionTitle(dimension),
        body: `${dimension.recommendations[0]} Signal: ${dimension.findings[0]}`,
        severity: severityForScore(dimension.score, kind === "quality"),
        score: dimension.score,
        metadata: {
          kind,
          confidence: percent(dimension.confidence),
          metrics: dimension.metricIds.slice(0, 3).join(", "),
        },
      };
    }) satisfies AnalysisSectionItem[];

  return [...claimActions, ...proofreadActions, ...dimensionActions]
    .sort((left, right) => actionWeight(right, result.inputSummary.goal) - actionWeight(left, result.inputSummary.goal))
    .slice(0, 8);
}

function dimensionScore(result: AnalysisResult, ids: string[]): number | undefined {
  const matches = result.dimensions.filter((dimension) => ids.includes(dimension.id));
  if (matches.length === 0) {
    return undefined;
  }
  return Math.round(matches.reduce((total, dimension) => total + dimension.score, 0) / matches.length);
}

function statusForAuditScore(score: number | undefined, inverted = false): string {
  if (score === undefined) {
    return "not checked";
  }
  const value = inverted ? 100 - score : score;
  if (value >= 78) {
    return "strong";
  }
  if (value >= 62) {
    return "good";
  }
  if (value >= 42) {
    return "review";
  }
  return "needs work";
}

function severityForAuditScore(score: number | undefined, inverted = false): Severity {
  if (score === undefined) {
    return "low";
  }
  const value = inverted ? 100 - score : score;
  if (value < 45) {
    return "high";
  }
  if (value < 65) {
    return "medium";
  }
  return "low";
}

function contentAuditItems(result: AnalysisResult): AnalysisSectionItem[] {
  const readabilityScore = dimensionScore(result, ["readability", "scannability", "mechanics", "readability_formula"]);
  const readerValueScore = dimensionScore(result, ["specificity", "depth", "actionability"]);
  const structureScore = dimensionScore(result, ["structure", "scannability"]);
  const evidenceScore = dimensionScore(result, ["evidence_density"]);
  const unresolvedClaims =
    result.claimReview.unsupportedClaims +
    result.claimReview.inlineCitationOnly +
    result.claimReview.partiallySupportedByProvidedMaterial +
    result.claimReview.notCheckedClaims;
  const proofreadingIssues = result.proofreading.issues.filter((issue) => issue.severity !== "low").length;

  return [
    {
      id: "audit-plain-language",
      title: "Plain-language load",
      body:
        readabilityScore !== undefined && readabilityScore < 65
          ? "Long or heavy constructions may slow comprehension; start with sentence and paragraph breaks."
          : "Sentence length, mechanics, and formula checks look reviewable for a first pass.",
      severity: severityForAuditScore(readabilityScore),
      score: readabilityScore,
      status: statusForAuditScore(readabilityScore),
      metadata: { kind: "quality", metrics: "readability, scannability, mechanics" },
    },
    {
      id: "audit-scannability",
      title: "Scannability",
      body:
        structureScore !== undefined && structureScore < 62
          ? "The draft may need clearer sectioning, shorter blocks, or task-oriented lists."
          : "Structure and scan cues look usable for quick editorial review.",
      severity: severityForAuditScore(structureScore),
      score: structureScore,
      status: statusForAuditScore(structureScore),
      metadata: { kind: "quality", metrics: "structure, scannability" },
    },
    {
      id: "audit-reader-value",
      title: "Reader value",
      body:
        readerValueScore !== undefined && readerValueScore < 62
          ? "Add concrete examples, reasoning, constraints, or a clearer next step."
          : "Specificity, reasoning depth, and next-step signals are present.",
      severity: severityForAuditScore(readerValueScore),
      score: readerValueScore,
      status: statusForAuditScore(readerValueScore),
      metadata: { kind: "quality", metrics: "specificity, depth, actionability" },
    },
    {
      id: "audit-evidence-readiness",
      title: "Evidence readiness",
      body:
        result.claimReview.factualClaims === 0
          ? "No factual claims were found that need source-support review."
          : `${result.claimReview.factualClaims} factual claim(s); ${unresolvedClaims} need source support, cited material, or tighter wording.`,
      severity: unresolvedClaims > 0 || result.claimReview.freshnessRiskClaims > 0 ? "medium" : "low",
      score: evidenceScore,
      status: unresolvedClaims > 0 ? "review" : result.summary.sourceBand,
      metadata: {
        kind: "claim",
        factualClaims: result.claimReview.factualClaims,
        unresolvedClaims,
        freshnessRiskClaims: result.claimReview.freshnessRiskClaims,
      },
    },
    {
      id: "audit-provenance-risk",
      title: "Provenance review",
      body: `Review clustered provenance-risk markers as context signals only; they are not authorship determinations. Confidence: ${percent(result.summary.provenanceConfidence)}.`,
      severity:
        result.summary.provenanceBand === "high"
          ? "high"
          : result.summary.provenanceBand === "elevated"
            ? "medium"
            : "low",
      status: compactLabel(result.summary.provenanceBand),
      metadata: { kind: "provenance", confidence: percent(result.summary.provenanceConfidence) },
    },
    {
      id: "audit-proofreading",
      title: "Proofreading readiness",
      body:
        result.proofreading.status === "available"
          ? `${result.proofreading.issues.length} local issue(s), including ${proofreadingIssues} medium/high issue(s).`
          : (result.proofreading.caveats[0] ?? "Proofreading did not run for this analysis."),
      severity: proofreadingIssues > 0 ? "medium" : "low",
      status: result.proofreading.status,
      metadata: { kind: "proofreading", issueCount: result.proofreading.issues.length },
    },
  ];
}

function rawDiagnosticItems(rawMetrics: AnalysisResult["rawMetrics"]): AnalysisSectionItem[] {
  if (!rawMetrics) {
    return [];
  }
  const items: AnalysisSectionItem[] = [];
  for (const [key, value] of Object.entries(rawMetrics)) {
    if (typeof value === "number") {
      items.push({
        id: `metric-${key}`,
        title: key,
        body: String(value),
        score: Number(value.toFixed(3)),
      });
    } else if (key === "ngramRepetition" && value && typeof value === "object") {
      for (const [length, count] of Object.entries(value)) {
        const numeric = typeof count === "number" ? count : Number(count);
        items.push({
          id: `metric-ngram-repetition-${length}`,
          title: `ngramRepetition.${length}`,
          body: String(numeric),
          score: Number(numeric.toFixed(3)),
        });
      }
    }
  }
  return items;
}

export function buildAnalysisSections(result: AnalysisResult): AnalysisSection[] {
  const qualityDimensions = result.dimensions.filter(isQualityDimension);
  const provenanceDimensions = result.dimensions.filter(isProvenanceDimension);
  const claimItems = result.claims.slice(0, 16).map((claim) => ({
    id: claim.id,
    title: compactLabel(claim.status),
    body: [
      claim.claim,
      claim.recommendedAction ? `Action: ${claim.recommendedAction}` : "",
      claim.supportGaps.length > 0 ? `Gaps: ${claim.supportGaps.slice(0, 2).join(" | ")}` : "",
    ].filter(Boolean).join(" "),
    severity: claim.importance,
    status: compactLabel(claim.status),
      metadata: {
        type: claim.type,
        coverage: claim.supportCoverage,
        freshnessRisk: claim.freshnessRisk,
        supportNeed: claim.supportNeed,
        action: claim.recommendedAction,
        gaps: claim.supportGaps.slice(0, 2).join(" | "),
      },
    })) satisfies AnalysisSectionItem[];
  const proofreadItems = result.proofreading.issues.slice(0, 16).map((issue) => ({
    id: issue.id,
    title: issue.kind,
    body: issue.message,
    severity: issue.severity,
    status: issue.source,
    metadata: {
      suggestions: issue.suggestions.join(", "),
      confidence: percent(issue.confidence),
    },
  })) satisfies AnalysisSectionItem[];
  const passageItems = result.spans.slice(0, 14).map((span, index) => ({
    id: span.id ?? `span-${index + 1}`,
    title: compactLabel(span.label),
    body: span.explanation,
    severity: span.severity,
    metadata: {
      start: span.start,
      end: span.end,
      suggestion: span.suggestion,
    },
  })) satisfies AnalysisSectionItem[];

  return [
    {
      id: "top-actions",
      title: "Top Actions",
      kind: "top_actions",
      summary: "Highest-value edits and review steps.",
      items: topActions(result),
    },
    {
      id: "score-overview",
      title: "Score Overview",
      kind: "score_overview",
      summary: result.summary.headline,
      items: [
        {
          id: "provenance-band",
          title: "Provenance-risk",
          body: compactLabel(result.summary.provenanceBand),
          score: Math.round(result.summary.provenanceConfidence * 100),
          status: result.summary.provenanceBand,
        },
        {
          id: "quality-band",
          title: "Writing quality",
          body: result.summary.qualityBand,
          status: result.summary.qualityBand,
        },
        {
          id: "source-band",
          title: "Source support",
          body: compactLabel(result.summary.sourceBand),
          status: result.summary.sourceBand,
        },
      ],
    },
    {
      id: "content-audit",
      title: "Content Audit",
      kind: "content_audit",
      summary: "Author-facing audit signals grouped by the edit they support.",
      items: contentAuditItems(result),
    },
    {
      id: "context-confidence",
      title: "Context And Confidence",
      kind: "context_confidence",
      summary: `${result.context.wordCount} words, ${result.context.sentenceCount} sentences, ${result.context.paragraphCount} paragraphs.`,
      items: [
        {
          id: "language",
          title: "Language",
          body: result.context.detectedLanguage,
          score: Math.round(result.context.languageConfidence * 100),
        },
        {
          id: "genre",
          title: "Genre",
          body: result.context.detectedGenre,
          score: Math.round(result.context.genreConfidence * 100),
        },
        {
          id: "goal",
          title: "Review focus",
          body: readableGoal(result.inputSummary.goal),
          severity: "low" as Severity,
        },
        {
          id: "sources",
          title: "Provided sources",
          body: `${result.inputSummary.sourceCount} source${result.inputSummary.sourceCount === 1 ? "" : "s"}`,
          severity: result.inputSummary.sourceCount > 0 ? "low" as Severity : "medium" as Severity,
        },
        ...(result.context.extraction?.confidence !== undefined
          ? [
              {
                id: "extraction-confidence",
                title: "Extraction confidence",
                body: percent(result.context.extraction.confidence),
                severity: result.context.extraction.confidence < 0.5 ? "medium" as Severity : "low" as Severity,
              },
            ]
          : []),
        ...result.context.assumptions.slice(0, 6).map((assumption, index) => ({
          id: `assumption-${index + 1}`,
          title: "Assumption",
          body: assumption,
          severity: "low" as Severity,
        })),
      ],
    },
    {
      id: "writing-quality",
      title: "Writing Quality",
      kind: "writing_quality",
      items: topDimensionItems(qualityDimensions, true, 10),
    },
    {
      id: "provenance-risk",
      title: "Provenance-Risk Signals",
      kind: "provenance_risk",
      summary: "Signals that deserve editorial review; these are not authorship determinations.",
      items: topDimensionItems(provenanceDimensions),
    },
    {
      id: "proofreading",
      title: "Proofreading",
      kind: "proofreading",
      summary:
        result.proofreading.status === "available"
          ? `${result.proofreading.issues.length} local proofreading issue(s).`
          : result.proofreading.caveats[0],
      items: proofreadItems,
    },
    {
      id: "claim-review",
      title: "Claim And Source Review",
      kind: "claim_review",
      summary: `${result.claimReview.supportedByProvidedMaterial} supported, ${result.claimReview.partiallySupportedByProvidedMaterial} partially supported, ${result.claimReview.inlineCitationOnly} inline-citation only, ${result.claimReview.unsupportedClaims} unsupported, ${result.claimReview.notCheckedClaims} not checked.`,
      items: claimItems,
    },
    {
      id: "highlighted-passages",
      title: "Highlighted Passages",
      kind: "highlighted_passages",
      items: passageItems,
    },
    {
      id: "caveats",
      title: "Caveats",
      kind: "caveats",
      items: [...result.summary.caveats, ...result.claimReview.caveats, ...result.proofreading.caveats]
        .filter((entry, index, entries) => entries.indexOf(entry) === index)
        .map((caveat, index) => ({
          id: `caveat-${index + 1}`,
          title: "Caveat",
          body: caveat,
          severity: "low" as Severity,
        })),
    },
    {
      id: "raw-diagnostics",
      title: "Raw Diagnostics",
      kind: "raw_diagnostics",
      summary: result.rawMetrics ? "Raw metrics were included for research or diagnostics." : "Raw metrics were not requested.",
      items: rawDiagnosticItems(result.rawMetrics),
    },
  ];
}

export function buildReportView(result: AnalysisResult, profile: ReportProfile = result.reportProfile): ReportView {
  const sections = result.analysisSections.length > 0 ? result.analysisSections : buildAnalysisSections(result);
  const filtered =
    profile === "checklist"
      ? sections.filter((section) => ["top_actions", "content_audit", "claim_review", "proofreading", "caveats"].includes(section.kind))
      : profile === "machine"
        ? sections.filter((section) => section.kind === "raw_diagnostics")
        : sections;
  return {
    profile,
    title: "Content Analysis Report",
    generatedAt: result.generatedAt,
    headline: result.summary.headline,
    sections: filtered,
  };
}

export function renderMarkdownReport(result: AnalysisResult, profile: ReportProfile = result.reportProfile): string {
  const markdownProfile = profile === "claims-csv" ? "checklist" : profile;
  const view = buildReportView(result, markdownProfile);
  const lines: string[] = [
    "# Content Analysis Report",
    "",
    `Generated: ${view.generatedAt}`,
    `Profile: ${view.profile}`,
    "",
    "## Summary",
    "",
    view.headline,
    "",
    `- Provenance-risk band: ${compactLabel(result.summary.provenanceBand)} (${percent(result.summary.provenanceConfidence)} confidence)`,
    `- Quality band: ${result.summary.qualityBand}`,
    `- Source-support band: ${compactLabel(result.summary.sourceBand)}`,
  ];

  for (const section of view.sections) {
    if (markdownProfile === "checklist" && section.items.length === 0) {
      continue;
    }
    lines.push("", `## ${section.title}`, "");
    if (section.summary) {
      lines.push(section.summary, "");
    }
    if (section.items.length === 0) {
      lines.push("- No major items.");
      continue;
    }
    for (const item of section.items) {
      const parts = [item.status ? `[${item.status}]` : "", item.score !== undefined ? `(${item.score})` : ""]
        .filter(Boolean)
        .join(" ");
      lines.push(`- ${parts ? `${parts} ` : ""}${item.title}: ${item.body}`);
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, "\"\"")}"`;
}

export function renderClaimsCsv(result: AnalysisResult): string {
  const rows = [
    [
      "id",
      "status",
      "type",
      "importance",
      "supportNeed",
      "freshnessRisk",
      "supportCoverage",
      "sentenceIndex",
      "paragraphIndex",
      "entities",
      "numbers",
      "dates",
      "inlineCitations",
      "supportGaps",
      "recommendedAction",
      "claim",
      "evidence",
      "notes",
    ],
    ...result.claims.map((claim) => [
      claim.id,
      claim.status,
      claim.type,
      claim.importance,
      claim.supportNeed,
      claim.freshnessRisk,
      claim.supportCoverage,
      claim.sentenceIndex,
      claim.paragraphIndex ?? "",
      claim.entities.join("; "),
      claim.numbers.join("; "),
      claim.dates.join("; "),
      claim.inlineCitations.join("; "),
      claim.supportGaps.join("; "),
      claim.recommendedAction,
      claim.claim,
      claim.evidence.join("; "),
      claim.notes,
    ]),
  ];
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}
