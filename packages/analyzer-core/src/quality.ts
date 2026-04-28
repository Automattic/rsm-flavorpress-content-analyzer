import { bloatPhrases } from "./registries.js";
import { clampConfidence, clampScore } from "./metrics.js";
import type {
  AnalysisMetadata,
  Dimension,
  PreparedText,
  QualityBand,
  RawMetrics,
  ScoreContribution,
  TextSpan,
} from "./types.js";

interface QualityAnalysis {
  dimensions: Dimension[];
  spans: TextSpan[];
  band: QualityBand;
  recommendations: string[];
}

function makeDimension(input: {
  id: string;
  label: string;
  family: string;
  score: number;
  confidence?: number;
  findings: string[];
  recommendations: string[];
  contributions: ScoreContribution[];
  reasonCodes?: string[];
}): Dimension {
  return {
    id: input.id,
    label: input.label,
    family: input.family,
    score: clampScore(input.score),
    confidence: clampConfidence(input.confidence ?? 0.7),
    findings: input.findings,
    recommendations: input.recommendations,
    falsePositiveContexts: [],
    reasonCodes: input.reasonCodes ?? input.contributions.map((entry) => entry.reasonCode),
    metricIds: [...new Set(input.contributions.map((entry) => entry.metricId))],
    scoreContributions: input.contributions,
  };
}

function contribution(input: {
  metricId: string;
  label: string;
  value: number;
  weight: number;
  impact?: number;
  direction?: ScoreContribution["direction"];
  reasonCode: string;
}): ScoreContribution {
  return {
    metricId: input.metricId,
    label: input.label,
    value: Number(input.value.toFixed(4)),
    weight: input.weight,
    impact: Number((input.impact ?? input.value * input.weight).toFixed(2)),
    direction: input.direction ?? "positive",
    reasonCode: input.reasonCode,
  };
}

function bandFromScore(score: number): QualityBand {
  if (score >= 78) {
    return "strong";
  }
  if (score >= 62) {
    return "good";
  }
  if (score >= 42) {
    return "fair";
  }
  return "poor";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countPattern(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

function hasActionLanguage(text: string): boolean {
  return /\b(start|choose|review|compare|contact|download|sign up|schedule|apply|use|open|check|fix|update|replace)\b/iu.test(text);
}

function findBloatSpans(input: PreparedText): TextSpan[] {
  const spans: TextSpan[] = [];
  for (const phrase of bloatPhrases) {
    const pattern = new RegExp(escapeRegExp(phrase), "giu");
    for (const match of input.lower.matchAll(pattern)) {
      const start = match.index ?? 0;
      spans.push({
        start,
        end: start + match[0].length,
        label: "bloated_phrase",
        severity: "low",
        explanation: "This phrase often adds formality without adding much information.",
        suggestion: "Replace it with a direct claim, specific evidence, or remove it.",
      });
    }
  }
  return spans;
}

export function analyzeQuality(
  input: PreparedText,
  metrics: RawMetrics,
  metadata?: AnalysisMetadata,
): QualityAnalysis {
  const lower = input.lower;
  const dimensions: Dimension[] = [];
  const recommendations: string[] = [];
  const bloatCount = bloatPhrases.reduce(
    (total, phrase) => total + countPattern(lower, new RegExp(escapeRegExp(phrase), "giu")),
    0,
  );
  const numberCount = countPattern(input.normalized, /\b\d+(?:[.,]\d+)?%?\b/gu);
  const properNameCount = countPattern(input.normalized, /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/gu);
  const causalCount = countPattern(
    lower,
    /\b(because|therefore|so that|as a result|tradeoff|however|although|since|debido a|por lo tanto|porque|portanto|car|donc|weil|deshalb)\b/giu,
  );
  const paragraphAverage = input.words.length / Math.max(1, input.paragraphs.length);
  const profileContext = `${metadata?.genre ?? input.detectedGenre} ${metadata?.channel ?? ""}`.toLowerCase();
  const genreIsDense = /legal|academic|policy|documentation|support/u.test(profileContext);

  const readabilityScore =
    100 -
    Math.max(0, metrics.meanSentenceWords - (genreIsDense ? 24 : 20)) * 2.2 -
    Math.max(0, paragraphAverage - (genreIsDense ? 145 : 120)) * 0.35 -
    Math.min(18, metrics.longSentenceRate * 36) -
    Math.min(16, metrics.longParagraphRate * 32) -
    (metrics.meanSentenceWords < 6 && input.sentences.length > 4 ? 12 : 0);
  const readabilityContributions = [
    contribution({
      metricId: "mean_sentence_words",
      label: "Sentence length fit",
      value: metrics.meanSentenceWords,
      weight: -2.2,
      impact: -Math.max(0, metrics.meanSentenceWords - (genreIsDense ? 24 : 20)) * 2.2,
      direction: "negative",
      reasonCode: "sentence_length_drag",
    }),
    contribution({
      metricId: "paragraph_average_words",
      label: "Paragraph length fit",
      value: paragraphAverage,
      weight: -0.35,
      impact: -Math.max(0, paragraphAverage - (genreIsDense ? 145 : 120)) * 0.35,
      direction: "negative",
      reasonCode: "paragraph_length_drag",
    }),
    contribution({
      metricId: "long_sentence_rate",
      label: "Long sentence rate",
      value: metrics.longSentenceRate,
      weight: -36,
      impact: -Math.min(18, metrics.longSentenceRate * 36),
      direction: "negative",
      reasonCode: "long_sentence_drag",
    }),
    contribution({
      metricId: "long_paragraph_rate",
      label: "Long paragraph rate",
      value: metrics.longParagraphRate,
      weight: -32,
      impact: -Math.min(16, metrics.longParagraphRate * 32),
      direction: "negative",
      reasonCode: "long_paragraph_drag",
    }),
  ];
  dimensions.push(
    makeDimension({
      id: "readability",
      label: "Readability",
      family: "style",
      score: readabilityScore,
      findings: readabilityScore < 62 ? ["Sentence or paragraph length may slow scanning for the intended reader."] : [],
      recommendations: ["Shorten dense sentences and split long paragraphs where comprehension matters."],
      contributions: readabilityContributions,
    }),
  );

  const scanStructureBonus = Math.min(12, input.headingCount * 3 + (input.listItemCount > 0 && input.words.length > 120 ? 5 : 0));
  const scannabilityScore =
    78 +
    scanStructureBonus -
    Math.min(34, metrics.longSentenceRate * 68) -
    Math.min(28, metrics.longParagraphRate * 56) -
    Math.min(18, Math.max(0, metrics.maxSentenceWords - (genreIsDense ? 44 : 36)) * 1.2);
  dimensions.push(
    makeDimension({
      id: "scannability",
      label: "Scannability",
      family: "style",
      score: scannabilityScore,
      findings:
        scannabilityScore < 66
          ? ["Long sentences, dense paragraphs, or weak section breaks may make the draft harder to scan."]
          : [],
      recommendations: ["Break the longest sentences, split dense paragraphs, and use headings or lists for reader tasks."],
      contributions: [
        contribution({
          metricId: "long_sentence_rate",
          label: "Long sentence rate",
          value: metrics.longSentenceRate,
          weight: -68,
          impact: -Math.min(34, metrics.longSentenceRate * 68),
          direction: "negative",
          reasonCode: "scan_long_sentences",
        }),
        contribution({
          metricId: "long_paragraph_rate",
          label: "Long paragraph rate",
          value: metrics.longParagraphRate,
          weight: -56,
          impact: -Math.min(28, metrics.longParagraphRate * 56),
          direction: "negative",
          reasonCode: "scan_long_paragraphs",
        }),
        contribution({
          metricId: "heading_coverage",
          label: "Scan structure support",
          value: metrics.headingCoverage,
          weight: 3,
          impact: scanStructureBonus,
          direction: "positive",
          reasonCode: "scan_structure_support",
        }),
      ],
    }),
  );

  const bloatScore = 100 - bloatCount * 12 - metrics.repeatedWordRate * 160;
  const bloatContributions = [
    contribution({
      metricId: "bloat_phrase_count",
      label: "Bloated phrase count",
      value: bloatCount,
      weight: -12,
      direction: "negative",
      reasonCode: "bloated_phrasing",
    }),
    contribution({
      metricId: "repeated_word_rate",
      label: "Repeated word rate",
      value: metrics.repeatedWordRate,
      weight: -160,
      direction: "negative",
      reasonCode: "repetition_drag",
    }),
  ];
  dimensions.push(
    makeDimension({
      id: "bloat",
      label: "Bloat",
      family: "lexical",
      score: bloatScore,
      findings: bloatScore < 72 ? ["The text contains redundant, filler, or overly generic phrasing."] : [],
      recommendations: ["Cut generic openings, repeated caveats, and phrases that do not add evidence."],
      contributions: bloatContributions,
    }),
  );

  const specificityScore = Math.min(100, 30 + numberCount * 8 + properNameCount * 4 + Math.min(18, metrics.entityDensity * 1.4));
  const specificityContributions = [
    contribution({
      metricId: "number_density",
      label: "Numbers and measurements",
      value: numberCount,
      weight: 8,
      reasonCode: "specific_numbers",
    }),
    contribution({
      metricId: "entity_density",
      label: "Named entities",
      value: properNameCount,
      weight: 4,
      reasonCode: "named_entities",
    }),
  ];
  dimensions.push(
    makeDimension({
      id: "specificity",
      label: "Specificity",
      family: "specificity",
      score: specificityScore,
      confidence: metadata?.audience || metadata?.locale ? 0.65 : 0.45,
      findings: specificityScore < 55 ? ["The text has limited concrete examples, names, numbers, places, or constraints."] : [],
      recommendations: ["Add specific examples, mechanisms, numbers, or audience-relevant constraints."],
      contributions: specificityContributions,
    }),
  );

  const depthScore = Math.min(100, 35 + causalCount * 8 + Math.min(25, input.paragraphs.length * 4) + Math.min(14, metrics.evidenceDensity * 6));
  const depthContributions = [
    contribution({
      metricId: "causal_connector_count",
      label: "Causal and contrast markers",
      value: causalCount,
      weight: 8,
      reasonCode: "causal_depth",
    }),
    contribution({
      metricId: "evidence_density",
      label: "Evidence density",
      value: metrics.evidenceDensity,
      weight: 6,
      reasonCode: "evidence_depth",
    }),
  ];
  dimensions.push(
    makeDimension({
      id: "depth",
      label: "Depth",
      family: "discourse",
      score: depthScore,
      findings: depthScore < 60 ? ["Claims are not consistently explained with causes, mechanisms, tradeoffs, or counterpoints."] : [],
      recommendations: ["For important claims, add the why, mechanism, constraint, or tradeoff."],
      contributions: depthContributions,
    }),
  );

  const structureScore =
    55 +
    Math.min(20, input.headingCount * 4) +
    (input.paragraphs.length >= 3 ? 12 : -10) +
    (input.listItemCount > 0 && input.words.length > 120 ? 8 : 0);
  dimensions.push(
    makeDimension({
      id: "structure",
      label: "Structure",
      family: "discourse",
      score: structureScore,
      findings: structureScore < 60 ? ["The opening, flow, or sectioning could be easier to scan."] : [],
      recommendations: ["Make the main point early, then group supporting details by reader task."],
      contributions: [
        contribution({
          metricId: "heading_coverage",
          label: "Heading coverage",
          value: metrics.headingCoverage,
          weight: 10,
          reasonCode: "heading_coverage",
        }),
        contribution({
          metricId: "paragraph_count",
          label: "Paragraph grouping",
          value: input.paragraphs.length,
          weight: 4,
          reasonCode: "paragraph_grouping",
        }),
      ],
    }),
  );

  const formalContext = /legal|academic|policy|government|support|corporate/i.test(profileContext);
  const toneScore =
    formalContext || !/\b(therefore|moreover|furthermore|pursuant|hereby|crucial role)\b/iu.test(lower)
      ? 76 - Math.min(12, metrics.weaselDensity * 4)
      : 52;
  dimensions.push(
    makeDimension({
      id: "tone_fit",
      label: "Tone / Register Fit",
      family: "register",
      score: toneScore,
      confidence: metadata?.genre || metadata?.channel || metadata?.audience ? 0.7 : 0.38,
      findings: toneScore < 65 ? ["The tone may be more formal or institutional than the current context needs."] : [],
      recommendations: ["Adjust formality to the genre, reader, channel, and desired action."],
      contributions: [
        contribution({
          metricId: "weasel_density",
          label: "Vague qualifier density",
          value: metrics.weaselDensity,
          weight: -4,
          direction: "negative",
          reasonCode: "vague_qualifiers",
        }),
      ],
    }),
  );

  const actionabilityScore = hasActionLanguage(lower) ? 78 + Math.min(16, metrics.actionabilityDensity * 5) : input.words.length > 160 ? 48 : 62;
  dimensions.push(
    makeDimension({
      id: "actionability",
      label: "Actionability",
      family: "pragmatic",
      score: actionabilityScore,
      findings: actionabilityScore < 62 ? ["The reader may not know what to do next after reading."] : [],
      recommendations: ["Add a clear next step, decision, or practical takeaway where appropriate."],
      contributions: [
        contribution({
          metricId: "actionability_density",
          label: "Action-oriented language",
          value: metrics.actionabilityDensity,
          weight: 5,
          reasonCode: "action_language",
        }),
      ],
    }),
  );

  const needsVisibleEvidence =
    metrics.claimLikeSentenceCount > 0 &&
    (input.words.length > 120 || metadata?.genre === "marketing" || metadata?.goal === "source_support");
  const citationScore =
    metrics.citationCount + metrics.urlCount > 0
      ? 68 + Math.min(24, metrics.citationProximity * 24)
      : needsVisibleEvidence || input.words.length > 180
        ? 45
        : 62;
  dimensions.push(
    makeDimension({
      id: "evidence_density",
      label: "Evidence Density",
      family: "source",
      score: citationScore,
      findings: citationScore < 60 ? ["Important factual claims may need visible source support."] : [],
      recommendations: ["Add citations or source links for high-impact, current, legal, price, ranking, or technical claims."],
      contributions: [
        contribution({
          metricId: "citation_proximity",
          label: "Citation proximity to claims",
          value: metrics.citationProximity,
          weight: 24,
          reasonCode: "citation_near_claims",
        }),
        contribution({
          metricId: "evidence_density",
          label: "Evidence density",
          value: metrics.evidenceDensity,
          weight: 8,
          reasonCode: "provided_evidence_density",
        }),
      ],
    }),
  );

  const mechanicsScore = 100 - Math.min(38, metrics.passiveVoiceRate * 5) - Math.min(24, metrics.nominalizationDensity * 0.6);
  dimensions.push(
    makeDimension({
      id: "mechanics",
      label: "Mechanics",
      family: "style",
      score: mechanicsScore,
      confidence: input.detectedLanguage === "en" ? 0.62 : 0.35,
      findings: mechanicsScore < 72 ? ["Passive constructions or nominalizations may make the text heavier than necessary."] : [],
      recommendations: ["Where clarity matters, prefer active verbs and concrete actions."],
      contributions: [
        contribution({
          metricId: "passive_voice_rate",
          label: "Passive-voice heuristic",
          value: metrics.passiveVoiceRate,
          weight: -5,
          direction: "negative",
          reasonCode: "passive_voice",
        }),
        contribution({
          metricId: "nominalization_density",
          label: "Nominalization density",
          value: metrics.nominalizationDensity,
          weight: -0.6,
          direction: "negative",
          reasonCode: "nominalized_language",
        }),
      ],
    }),
  );

  const formulaScore = Math.max(
    0,
    Math.min(100, 100 - Math.abs(metrics.meanSentenceWords - 18) * 2 - Math.max(0, paragraphAverage - 110) * 0.25),
  );
  dimensions.push(
    makeDimension({
      id: "readability_formula",
      label: "Readability Formula",
      family: "style",
      score: formulaScore,
      confidence: 0.42,
      findings: formulaScore < 64 ? ["Formula-based readability checks suggest this may be slower to scan."] : [],
      recommendations: ["Use formula scores as a prompt to inspect long sentences, not as a strict grade target."],
      contributions: [
        contribution({
          metricId: "mean_sentence_words",
          label: "Mean sentence words",
          value: metrics.meanSentenceWords,
          weight: -2,
          direction: "negative",
          reasonCode: "formula_sentence_length",
        }),
      ],
    }),
  );

  for (const entry of dimensions) {
    if (entry.findings.length > 0 && entry.recommendations[0]) {
      recommendations.push(entry.recommendations[0]);
    }
  }

  const average = dimensions.reduce((total, entry) => total + entry.score, 0) / Math.max(1, dimensions.length);
  return {
    dimensions,
    spans: findBloatSpans(input),
    band: bandFromScore(average),
    recommendations: [...new Set(recommendations)].slice(0, 8),
  };
}
