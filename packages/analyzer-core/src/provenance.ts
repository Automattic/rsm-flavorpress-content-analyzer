import { falsePositiveContexts, localTextureHints, phraseMarkers, type FeatureFamily } from "./registries.js";
import { clampConfidence, clampScore } from "./metrics.js";
import type {
  AnalysisMetadata,
  AnalysisMode,
  Dimension,
  PreparedText,
  RawMetrics,
  ScoreContribution,
  SignalBand,
  TextSpan,
} from "./types.js";

interface ProvenanceAnalysis {
  dimensions: Dimension[];
  spans: TextSpan[];
  band: SignalBand;
  confidence: number;
  caveats: string[];
}

interface ScoringProfile {
  riskMultiplier: number;
  structuralTolerance: number;
  specificityTolerance: number;
}

const formalGenres = new Set(["academic", "corporate", "documentation", "legal", "policy", "support"]);

function makeDimension(input: {
  id: string;
  label: string;
  family: FeatureFamily;
  score: number;
  confidence: number;
  findings: string[];
  recommendations?: string[];
  contributions: ScoreContribution[];
  reasonCodes?: string[];
  abstentionReason?: string;
}): Dimension {
  return {
    id: input.id,
    label: input.label,
    family: input.family,
    score: clampScore(input.score),
    confidence: clampConfidence(input.confidence),
    findings: input.findings,
    recommendations: input.recommendations ?? [],
    falsePositiveContexts: falsePositiveContexts[input.family],
    reasonCodes: input.reasonCodes ?? input.contributions.map((entry) => entry.reasonCode),
    metricIds: [...new Set(input.contributions.map((entry) => entry.metricId))],
    scoreContributions: input.contributions,
    abstentionReason: input.abstentionReason,
  };
}

function contribution(input: {
  metricId: string;
  label: string;
  value: number;
  weight: number;
  direction?: ScoreContribution["direction"];
  reasonCode: string;
}): ScoreContribution {
  return {
    metricId: input.metricId,
    label: input.label,
    value: Number(input.value.toFixed(4)),
    weight: input.weight,
    impact: Number((input.value * input.weight).toFixed(2)),
    direction: input.direction ?? "positive",
    reasonCode: input.reasonCode,
  };
}

function profileFor(mode: AnalysisMode, genre: string): ScoringProfile {
  const profile: ScoringProfile = {
    riskMultiplier: mode === "integrity" ? 1.12 : mode === "research" ? 1.05 : 1,
    structuralTolerance: 1,
    specificityTolerance: 1,
  };

  if (formalGenres.has(genre)) {
    profile.structuralTolerance = 0.78;
    profile.specificityTolerance = genre === "legal" || genre === "policy" ? 0.72 : 0.86;
  }
  if (genre === "marketing") {
    profile.specificityTolerance = 1.12;
  }
  return profile;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function findPhraseSpans(input: PreparedText): TextSpan[] {
  if (input.detectedLanguage === "unknown" || input.detectedLanguage === "unsupported") {
    return [];
  }
  const spans: TextSpan[] = [];
  for (const marker of phraseMarkers.filter((entry) => entry.language === input.detectedLanguage)) {
    const pattern = new RegExp(escapeRegExp(marker.phrase), "giu");
    for (const match of input.lower.matchAll(pattern)) {
      const start = match.index ?? 0;
      spans.push({
        start,
        end: start + match[0].length,
        label: "formulaic_phrase",
        severity: marker.severity,
        explanation: "Formulaic phrasing can contribute to an over-standardized explanatory register.",
        suggestion: "Keep it when the genre requires formal structure; otherwise replace it with a more direct transition.",
      });
    }
  }
  return spans;
}

function inferFormalContext(input: PreparedText, metadata?: AnalysisMetadata): boolean {
  const genre = (metadata?.genre ?? input.detectedGenre).toLowerCase();
  const channel = (metadata?.channel ?? "").toLowerCase();
  return formalGenres.has(genre) || formalGenres.has(channel);
}

function determineBand(input: PreparedText, dimensions: Dimension[], formalContext: boolean): {
  band: SignalBand;
  confidence: number;
  caveats: string[];
} {
  const caveats: string[] = [];
  if (input.textLengthStatus === "too_short") {
    return {
      band: "insufficient_evidence",
      confidence: 0.15,
      caveats: ["Provenance-risk scoring abstained because the text is too short."],
    };
  }
  if (input.textLengthStatus === "short") {
    caveats.push("Provenance-risk confidence is limited because the text is short.");
  }
  if (input.detectedLanguage === "unknown") {
    caveats.push("Language could not be detected with enough confidence.");
  }
  if (input.detectedLanguage === "unsupported") {
    caveats.push("Language is outside the first supported scoring set.");
  }

  const scored = dimensions.filter((entry) => entry.score >= 45);
  const strong = dimensions.filter((entry) => entry.score >= 60);
  const strongFamilies = new Set(strong.map((entry) => entry.family));
  const evidenceAverage =
    scored.length > 0 ? scored.reduce((total, entry) => total + entry.score, 0) / scored.length : 0;

  let band: SignalBand = "low";
  if (strongFamilies.size >= 4 && evidenceAverage >= 58) {
    band = "high";
  } else if (strongFamilies.size >= 2 || evidenceAverage >= 42) {
    band = "elevated";
  }

  if (formalContext && band === "high") {
    band = "elevated";
    caveats.push("High-confidence escalation was downgraded because the context is naturally formal.");
  }
  if (input.textLengthStatus === "short" && band === "high") {
    band = "elevated";
  }
  if ((input.detectedLanguage === "unknown" || input.detectedLanguage === "unsupported") && band === "high") {
    band = "elevated";
  }

  const confidence = clampConfidence(
    0.2 +
      Math.min(0.55, strongFamilies.size * 0.14) +
      (input.textLengthStatus === "sufficient" ? 0.15 : 0) -
      (formalContext ? 0.12 : 0),
  );

  return { band, confidence, caveats };
}

export function analyzeProvenanceSignals(
  input: PreparedText,
  metrics: RawMetrics,
  metadata?: AnalysisMetadata,
  mode: AnalysisMode = "editorial",
): ProvenanceAnalysis {
  const formalContext = inferFormalContext(input, metadata);
  const selectedGenre = (metadata?.genre ?? input.detectedGenre).toLowerCase();
  const profile = profileFor(mode, selectedGenre);
  const lower = input.lower;
  const dimensions: Dimension[] = [];
  const lexicalContributions = [
    contribution({
      metricId: "repeated_word_rate",
      label: "Repeated word rate",
      value: metrics.repeatedWordRate,
      weight: 420 * profile.riskMultiplier,
      reasonCode: "lexical_repetition",
    }),
    contribution({
      metricId: "repeated_phrase_count",
      label: "Repeated 3-word phrases",
      value: metrics.repeatedPhraseCount,
      weight: 8 * profile.riskMultiplier,
      reasonCode: "phrase_repetition",
    }),
    contribution({
      metricId: "normalized_lexical_diversity",
      label: "Low length-normalized lexical diversity",
      value: metrics.normalizedLexicalDiversity < 3.2 && input.words.length > 120 ? 1 : 0,
      weight: 18 * profile.riskMultiplier,
      reasonCode: "low_lexical_variety",
    }),
    contribution({
      metricId: "repeated_opening_count",
      label: "Repeated sentence openings",
      value: metrics.repeatedOpeningCount,
      weight: 10 * profile.riskMultiplier,
      reasonCode: "repeated_sentence_openings",
    }),
  ];

  dimensions.push(
    makeDimension({
      id: "lexical_repetition",
      label: "Lexical Repetition",
      family: "lexical",
      score: lexicalContributions.reduce((total, entry) => total + entry.impact, 0),
      confidence: 0.62,
      findings:
        metrics.repeatedWordRate > 0.08 || metrics.repeatedPhraseCount > 1 || metrics.repeatedOpeningCount > 1
          ? ["Repeated words, phrases, or sentence openings create a standardized texture."]
          : [],
      recommendations: ["Replace repeated abstract wording with concrete, audience-specific details."],
      contributions: lexicalContributions,
    }),
  );

  const hasTemplateStructure =
    input.paragraphs.length >= 4 &&
    (hasAny(lower, [/in conclusion|en conclusion|abschliessend/u]) || input.listItemCount >= 3);
  const discourseContributions = [
    contribution({
      metricId: "connector_density",
      label: "Connector density",
      value: metrics.connectorDensity,
      weight: 55 * profile.riskMultiplier * profile.structuralTolerance,
      reasonCode: "connector_density",
    }),
    contribution({
      metricId: "template_structure",
      label: "Template-like structure",
      value: hasTemplateStructure ? 1 : 0,
      weight: 35 * profile.riskMultiplier * profile.structuralTolerance,
      reasonCode: "template_structure",
    }),
    contribution({
      metricId: "sentence_length_variation",
      label: "Uniform sentence length",
      value: input.paragraphs.length >= 4 && metrics.sentenceLengthVariation < 0.35 ? 1 : 0,
      weight: 25 * profile.riskMultiplier * profile.structuralTolerance,
      reasonCode: "uniform_sentence_rhythm",
    }),
  ];
  dimensions.push(
    makeDimension({
      id: "discourse_regularity",
      label: "Discourse Regularity",
      family: "discourse",
      score: discourseContributions.reduce((total, entry) => total + entry.impact, 0),
      confidence: 0.58,
      findings: hasTemplateStructure
        ? ["The text follows a highly regular explanatory structure with connectors, lists, or a closing summary."]
        : [],
      recommendations: ["Vary structure where the channel expects a more direct voice."],
      contributions: discourseContributions,
    }),
  );

  const connectorContributions = [
    contribution({
      metricId: "connector_density",
      label: "Formal connector markers",
      value: metrics.connectorDensity,
      weight: 90 * profile.riskMultiplier * profile.structuralTolerance,
      reasonCode: "formal_connectors",
    }),
  ];
  dimensions.push(
    makeDimension({
      id: "connector_density",
      label: "Connector Density",
      family: "discourse",
      score: connectorContributions.reduce((total, entry) => total + entry.impact, 0),
      confidence: 0.45,
      findings:
        metrics.connectorCount > 0
          ? [`Detected ${metrics.connectorCount} formal connector marker(s). Phrase markers are weak evidence by themselves.`]
          : [],
      recommendations: ["Keep formal connectors only where they clarify the argument."],
      contributions: connectorContributions,
    }),
  );

  const formattingContributions = [
    contribution({
      metricId: "formatting_density",
      label: "Structural formatting density",
      value: metrics.formattingDensity,
      weight: 120 * profile.riskMultiplier * profile.structuralTolerance,
      reasonCode: "formatting_density",
    }),
    contribution({
      metricId: "heading_count",
      label: "Dense heading pattern",
      value: input.headingCount >= 3 ? 1 : 0,
      weight: 20 * profile.riskMultiplier * profile.structuralTolerance,
      reasonCode: "heading_density",
    }),
    contribution({
      metricId: "table_line_count",
      label: "Dense table pattern",
      value: input.tableLineCount >= 2 ? 1 : 0,
      weight: 20 * profile.riskMultiplier * profile.structuralTolerance,
      reasonCode: "table_density",
    }),
  ];
  dimensions.push(
    makeDimension({
      id: "formatting_density",
      label: "Formatting Density",
      family: "formatting",
      score: formattingContributions.reduce((total, entry) => total + entry.impact, 0),
      confidence: 0.48,
      findings:
        metrics.formattingDensity > 0.28
          ? ["Headings, bullets, tables, or quotes are dense enough to resemble templated formatting in some genres."]
          : [],
      recommendations: ["Use structured formatting when it helps scanning; remove it where the channel expects prose."],
      contributions: formattingContributions,
    }),
  );

  const rhythmValue =
    input.sentences.length >= 6 && metrics.sentenceLengthVariation < 0.32
      ? 62
      : input.sentences.length >= 6 && metrics.sentenceLengthVariation < 0.42
        ? 42
        : 12;
  const rhythmContributions = [
    contribution({
      metricId: "sentence_length_variation",
      label: "Sentence rhythm uniformity",
      value: rhythmValue,
      weight: profile.riskMultiplier * profile.structuralTolerance,
      reasonCode: "uniform_sentence_rhythm",
    }),
  ];
  dimensions.push(
    makeDimension({
      id: "sentence_rhythm",
      label: "Sentence Rhythm",
      family: "syntax",
      score: rhythmContributions.reduce((total, entry) => total + entry.impact, 0),
      confidence: 0.52,
      findings:
        input.sentences.length >= 6 && metrics.sentenceLengthVariation < 0.42
          ? ["Sentence lengths are unusually uniform for the amount of text."]
          : [],
      recommendations: ["Mix concise and developed sentences where that improves flow."],
      contributions: rhythmContributions,
    }),
  );

  const hasInstitutionalRegister = hasAny(lower, [
    /it is important to note/u,
    /plays a crucial role/u,
    /es importante senalar/u,
    /il convient de souligner/u,
    /es ist wichtig zu betonen/u,
  ]);
  const registerContributions = [
    contribution({
      metricId: "institutional_register",
      label: "Institutional register marker",
      value: formalContext ? 18 : hasInstitutionalRegister ? 58 : 20,
      weight: profile.riskMultiplier,
      reasonCode: formalContext ? "formal_context_expected" : "register_mismatch",
    }),
  ];
  dimensions.push(
    makeDimension({
      id: "register_mismatch",
      label: "Register Mismatch",
      family: "register",
      score: registerContributions.reduce((total, entry) => total + entry.impact, 0),
      confidence: metadata?.genre || metadata?.channel ? 0.58 : 0.35,
      findings:
        !formalContext && hasInstitutionalRegister
          ? ["The register reads more institutional or explanatory than the stated context appears to require."]
          : [],
      recommendations: ["Tune formality to the actual reader, channel, and purpose."],
      contributions: registerContributions,
    }),
  );

  const hasConcreteTexture = /\b\d+(?:[.,]\d+)?%?\b|\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/u.test(input.normalized);
  const specificityContributions = [
    contribution({
      metricId: "specific_texture",
      label: "Limited concrete details",
      value: input.words.length >= 180 && !hasConcreteTexture ? 58 : input.words.length >= 120 && !hasConcreteTexture ? 40 : 12,
      weight: profile.riskMultiplier * profile.specificityTolerance,
      reasonCode: "limited_concrete_texture",
    }),
  ];
  dimensions.push(
    makeDimension({
      id: "specific_texture",
      label: "Specific Texture",
      family: "specificity",
      score: specificityContributions.reduce((total, entry) => total + entry.impact, 0),
      confidence: metadata?.locale || metadata?.audience ? 0.5 : 0.28,
      findings:
        input.words.length >= 120 && !hasConcreteTexture
          ? [
              `The text has limited concrete texture; useful human markers could include ${
                input.detectedLanguage !== "unknown" && input.detectedLanguage !== "unsupported"
                  ? localTextureHints[input.detectedLanguage].join(", ")
                  : "local examples and audience-specific details"
              }.`,
            ]
          : [],
      recommendations: ["Add specific examples, constraints, places, numbers, or audience details when appropriate."],
      contributions: specificityContributions,
    }),
  );

  const band = determineBand(input, dimensions, formalContext);
  return {
    dimensions,
    spans: findPhraseSpans(input),
    band: band.band,
    confidence: band.confidence,
    caveats: band.caveats,
  };
}
