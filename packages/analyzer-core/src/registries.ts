import type { Severity, SupportedLanguage } from "./types.js";

export type FeatureFamily =
  | "lexical"
  | "syntax"
  | "discourse"
  | "register"
  | "specificity"
  | "formatting"
  | "source"
  | "pragmatic";

export interface PhraseMarker {
  id: string;
  language: SupportedLanguage;
  phrase: string;
  family: FeatureFamily;
  confidence: number;
  severity: Severity;
}

export const falsePositiveContexts: Record<FeatureFamily, string[]> = {
  lexical: ["non-native writing", "corporate prose", "support templates"],
  syntax: ["school essays", "translated copy", "policy writing"],
  discourse: ["academic writing", "legal writing", "structured explainers"],
  register: ["public-sector writing", "support scripts", "brand style guides"],
  specificity: ["early drafts", "privacy-preserving summaries", "generic policy pages"],
  formatting: ["CMS templates", "documentation pages", "checklists"],
  source: ["opinion pieces", "internal knowledge", "draft notes"],
  pragmatic: ["awareness content", "reference material", "legal notices"],
};

export const phraseMarkers: PhraseMarker[] = [
  { id: "en-connector-1", language: "en", phrase: "it is important to note", family: "discourse", confidence: 0.42, severity: "low" },
  { id: "en-connector-2", language: "en", phrase: "in conclusion", family: "discourse", confidence: 0.36, severity: "low" },
  { id: "en-register-1", language: "en", phrase: "plays a crucial role", family: "register", confidence: 0.38, severity: "low" },
  { id: "es-connector-1", language: "es", phrase: "es importante senalar", family: "discourse", confidence: 0.36, severity: "low" },
  { id: "es-connector-2", language: "es", phrase: "cabe destacar", family: "discourse", confidence: 0.38, severity: "low" },
  { id: "pt-connector-1", language: "pt", phrase: "e importante destacar", family: "discourse", confidence: 0.36, severity: "low" },
  { id: "fr-connector-1", language: "fr", phrase: "il est important de noter", family: "discourse", confidence: 0.36, severity: "low" },
  { id: "de-connector-1", language: "de", phrase: "es ist wichtig zu betonen", family: "discourse", confidence: 0.36, severity: "low" }
];

export const bloatPhrases = [
  "it is important to note",
  "in today's fast-paced world",
  "at the end of the day",
  "a wide range of",
  "plays a crucial role",
  "it goes without saying",
  "cabe destacar",
  "es importante senalar",
  "vale ressaltar",
  "il convient de souligner",
  "es ist wichtig zu betonen"
];

export const localTextureHints: Record<SupportedLanguage, string[]> = {
  en: ["specific examples", "concrete constraints", "reader context"],
  es: ["regional examples", "country-specific vocabulary", "reader context"],
  pt: ["regional examples", "platform-native phrasing", "reader context"],
  fr: ["locale-specific conventions", "reader context", "genre-appropriate register"],
  de: ["regional examples", "reader context", "genre-appropriate formality"]
};
