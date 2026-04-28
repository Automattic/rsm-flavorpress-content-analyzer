export const analysisModes = ["editorial", "integrity", "research"] as const;
export type AnalysisMode = (typeof analysisModes)[number];

export const analysisGoals = [
  "publish_ready_review",
  "source_support",
  "clarity_rewrite",
  "risk_review",
  "editorial_triage",
] as const;
export type AnalysisGoal = (typeof analysisGoals)[number];

export const analysisGenres = [
  "general",
  "article",
  "marketing",
  "support",
  "documentation",
  "policy",
  "legal",
  "academic",
  "corporate",
] as const;
export type AnalysisGenre = (typeof analysisGenres)[number];

export const supportedLanguages = ["en", "es", "pt", "fr", "de"] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];
export type LanguageCode = SupportedLanguage | "unknown" | "unsupported";
export type TextLengthStatus = "too_short" | "short" | "sufficient";
export const signalBands = ["low", "elevated", "high", "insufficient_evidence"] as const;
export type SignalBand = (typeof signalBands)[number];
export const qualityBands = ["poor", "fair", "good", "strong"] as const;
export type QualityBand = (typeof qualityBands)[number];
export const sourceBands = ["supported", "mixed", "weakly_supported", "not_checked"] as const;
export type SourceBand = (typeof sourceBands)[number];
export type Severity = "low" | "medium" | "high";
export type ClaimStatus = "supported" | "partially_supported" | "inline_citation_only" | "unsupported" | "not_checked";
export type ClaimSupportNeed = "none" | "recommended" | "important" | "essential";
export type ClaimType = "factual" | "opinion" | "prediction" | "recommendation" | "unverifiable";
export const reportProfiles = ["full", "checklist", "claims-csv", "machine"] as const;
export type ReportProfile = (typeof reportProfiles)[number];
export type ReportSectionKind =
  | "top_actions"
  | "score_overview"
  | "content_audit"
  | "context_confidence"
  | "writing_quality"
  | "provenance_risk"
  | "proofreading"
  | "claim_review"
  | "highlighted_passages"
  | "caveats"
  | "raw_diagnostics";
export type TextBlockType = "heading" | "paragraph" | "list" | "quote" | "table" | "code" | "other";
export type ParagraphRole = "opening" | "body" | "closing" | "short_note" | "structured_item";
export type ProofreadIssueKind = "spelling" | "grammar" | "style" | "typography" | "punctuation";
export type ProviderEgress = "none" | "localhost_only" | "remote";
export type ProviderStatus = "available" | "disabled" | "abstained" | "error";

export interface SourceInput {
  id?: string;
  title?: string;
  url?: string;
  citation?: string;
  text?: string;
}

export interface AnalysisMetadata {
  languageHint?: string;
  locale?: string;
  genre?: AnalysisGenre;
  audience?: string;
  channel?: string;
  purpose?: string;
  goal?: AnalysisGoal;
  sources?: Array<string | SourceInput>;
}

export interface AnalysisOptions {
  includeSpans?: boolean;
  includeRawMetrics?: boolean;
  allowPrivateNetwork?: boolean;
  reportProfile?: ReportProfile;
  includeProofreading?: boolean;
  languageToolUrl?: string;
}

export interface TextAnalysisRequest {
  text: string;
  mode?: AnalysisMode;
  metadata?: AnalysisMetadata;
  options?: AnalysisOptions;
}

export interface UrlAnalysisRequest extends Omit<TextAnalysisRequest, "text"> {
  url: string;
}

export type AnalysisRequest = TextAnalysisRequest | UrlAnalysisRequest;

export interface ExtractionContext {
  requestedUrl?: string;
  finalUrl?: string;
  title?: string;
  contentType?: string;
  confidence?: number;
  notes: string[];
}

export interface AnalysisContext {
  detectedLanguage: LanguageCode;
  languageConfidence: number;
  detectedGenre: AnalysisGenre;
  genreConfidence: number;
  textLengthStatus: TextLengthStatus;
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
  script: string;
  mixedLanguage: boolean;
  assumptions: string[];
  extraction?: ExtractionContext;
}

export interface AnalysisSummary {
  provenanceBand: SignalBand;
  provenanceConfidence: number;
  qualityBand: QualityBand;
  sourceBand: SourceBand;
  headline: string;
  caveats: string[];
  keyPoints: string[];
}

export interface Dimension {
  id: string;
  label: string;
  family: string;
  score: number;
  confidence: number;
  findings: string[];
  recommendations: string[];
  falsePositiveContexts: string[];
  reasonCodes: string[];
  metricIds: string[];
  scoreContributions: ScoreContribution[];
  abstentionReason?: string;
}

export interface TextSpan {
  id?: string;
  start: number;
  end: number;
  label: string;
  severity: Severity;
  explanation: string;
  suggestion: string;
}

export interface Claim {
  id: string;
  claim: string;
  type: ClaimType;
  status: ClaimStatus;
  start: number;
  end: number;
  sentenceIndex: number;
  paragraphIndex?: number;
  sectionId?: string;
  entities: string[];
  numbers: string[];
  dates: string[];
  importance: Severity;
  supportCoverage: number;
  evidence: string[];
  notes: string;
  freshnessRisk: boolean;
  inlineCitations: string[];
  supportNeed: ClaimSupportNeed;
  supportGaps: string[];
  recommendedAction: string;
}

export interface ClaimReview {
  totalClaims: number;
  factualClaims: number;
  supportedByProvidedMaterial: number;
  partiallySupportedByProvidedMaterial: number;
  inlineCitationOnly: number;
  unsupportedClaims: number;
  notCheckedClaims: number;
  freshnessRiskClaims: number;
  sourceCount: number;
  caveats: string[];
}

export interface ScoreContribution {
  metricId: string;
  label: string;
  value: number;
  weight: number;
  impact: number;
  direction: "positive" | "negative" | "neutral";
  reasonCode: string;
}

export interface TextBlockMetrics {
  wordCount: number;
  sentenceCount: number;
  citationCount: number;
  urlCount: number;
}

export interface TextBlock {
  id: string;
  type: TextBlockType;
  text: string;
  start: number;
  end: number;
  headingLevel?: number;
  parentSectionId?: string;
  paragraphRole?: ParagraphRole;
  metrics: TextBlockMetrics;
}

export interface TextSection {
  id: string;
  title: string;
  headingLevel: number;
  start: number;
  end: number;
  parentId?: string;
  blockIds: string[];
}

export interface RawMetrics {
  lexicalDiversity: number;
  normalizedLexicalDiversity: number;
  repeatedWordRate: number;
  repeatedPhraseCount: number;
  ngramRepetition: Record<2 | 3 | 4 | 5, number>;
  meanSentenceWords: number;
  maxSentenceWords: number;
  longSentenceRate: number;
  veryLongSentenceCount: number;
  sentenceLengthVariation: number;
  maxParagraphWords: number;
  longParagraphRate: number;
  paragraphLengthVariation: number;
  sentenceBurstiness: number;
  paragraphBurstiness: number;
  repeatedOpeningCount: number;
  connectorCount: number;
  connectorDensity: number;
  hedgeDensity: number;
  weaselDensity: number;
  passiveVoiceRate: number;
  nominalizationDensity: number;
  entityDensity: number;
  dateDensity: number;
  numberDensity: number;
  citationProximity: number;
  evidenceDensity: number;
  actionabilityDensity: number;
  quoteDensity: number;
  headingCoverage: number;
  claimLikeSentenceCount: number;
  formattingDensity: number;
  citationCount: number;
  urlCount: number;
}

export interface ProviderManifest {
  id: string;
  label: string;
  capabilities: string[];
  supportedLanguages: SupportedLanguage[];
  license: string;
  egress: ProviderEgress;
  artifactSizeBytes?: number;
  spanSupport: boolean;
  confidenceSemantics: string;
  enabledByDefault: boolean;
  notes: string[];
}

export interface ProofreadIssue {
  id: string;
  start: number;
  end: number;
  kind: ProofreadIssueKind;
  severity: Severity;
  message: string;
  suggestions: string[];
  source: string;
  confidence: number;
}

export interface ProofreadingResult {
  status: ProviderStatus;
  language: LanguageCode;
  providers: ProviderManifest[];
  issues: ProofreadIssue[];
  caveats: string[];
}

export interface AnalysisSectionItem {
  id: string;
  title: string;
  body: string;
  severity?: Severity;
  score?: number;
  status?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface AnalysisSection {
  id: string;
  title: string;
  kind: ReportSectionKind;
  summary?: string;
  items: AnalysisSectionItem[];
}

export interface InputSummary {
  inputType: "text" | "url";
  requestedUrl?: string;
  finalUrl?: string;
  title?: string;
  languageHint?: string;
  locale?: string;
  genre?: AnalysisGenre;
  audience?: string;
  goal?: AnalysisGoal;
  sourceCount: number;
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
}

export interface AnalysisResult {
  reportProfile: ReportProfile;
  inputSummary: InputSummary;
  analysisSections: AnalysisSection[];
  scoreContributions: ScoreContribution[];
  proofreading: ProofreadingResult;
  claimReview: ClaimReview;
  context: AnalysisContext;
  summary: AnalysisSummary;
  dimensions: Dimension[];
  spans: TextSpan[];
  claims: Claim[];
  recommendations: string[];
  rawMetrics?: RawMetrics;
  generatedAt: string;
}

export interface PreparedText {
  original: string;
  normalized: string;
  lower: string;
  words: string[];
  sentences: Array<{ text: string; start: number; end: number; words: string[] }>;
  paragraphs: Array<{ id: string; text: string; start: number; end: number; role: ParagraphRole; parentSectionId?: string }>;
  blocks: TextBlock[];
  sections: TextSection[];
  urls: Array<{ value: string; start: number; end: number }>;
  citations: Array<{ value: string; start: number; end: number }>;
  headingCount: number;
  listItemCount: number;
  tableLineCount: number;
  quoteLineCount: number;
  script: string;
  detectedLanguage: LanguageCode;
  languageConfidence: number;
  detectedGenre: AnalysisGenre;
  genreConfidence: number;
  mixedLanguage: boolean;
  textLengthStatus: TextLengthStatus;
  assumptions: string[];
}
