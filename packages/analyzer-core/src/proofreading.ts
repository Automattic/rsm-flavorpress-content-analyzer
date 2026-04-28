import type {
  AnalysisMetadata,
  PreparedText,
  ProofreadIssue,
  ProofreadingResult,
  ProviderManifest,
  SupportedLanguage,
} from "./types.js";

export const basicEnglishManifest: ProviderManifest = {
  id: "local-english-basic",
  label: "Local English Proofreading",
  capabilities: ["spelling", "typography", "style"],
  supportedLanguages: ["en"],
  license: "GPL-3.0-or-later",
  egress: "none",
  spanSupport: true,
  confidenceSemantics: "Deterministic local heuristics. Confidence reflects pattern precision, not grammatical certainty.",
  enabledByDefault: true,
  notes: ["Runs locally and does not call external services.", "Designed as a conservative first-pass issue detector."],
};

const commonMisspellings = new Map<string, string[]>([
  ["accomodate", ["accommodate"]],
  ["adress", ["address"]],
  ["analysys", ["analysis"]],
  ["artical", ["article"]],
  ["begining", ["beginning"]],
  ["definately", ["definitely"]],
  ["enviroment", ["environment"]],
  ["goverment", ["government"]],
  ["occured", ["occurred"]],
  ["recieve", ["receive"]],
  ["seperate", ["separate"]],
  ["succesful", ["successful"]],
  ["untill", ["until"]],
  ["wich", ["which"]],
]);

export function issue(
  input: Omit<ProofreadIssue, "id" | "source">,
  index: number,
  source = basicEnglishManifest.id,
): ProofreadIssue {
  return {
    ...input,
    id: `proofread-${index + 1}`,
    source,
  };
}

export function selectedLanguage(input: PreparedText, metadata?: AnalysisMetadata): SupportedLanguage | null {
  const hint = metadata?.languageHint?.trim().toLowerCase().slice(0, 2);
  if (hint === "en") {
    return "en";
  }
  return input.detectedLanguage === "en" ? "en" : null;
}

export function proofreadText(input: PreparedText, metadata?: AnalysisMetadata): ProofreadingResult {
  const providers = [basicEnglishManifest];
  const language = selectedLanguage(input, metadata);
  if (!language) {
    return {
      status: "abstained",
      language: input.detectedLanguage,
      providers,
      issues: [],
      caveats: ["Proofreading currently runs only for English content."],
    };
  }

  const issues: ProofreadIssue[] = [];
  const lower = input.normalized.toLowerCase();

  for (const [word, suggestions] of commonMisspellings.entries()) {
    const pattern = new RegExp(`\\b${word}\\b`, "giu");
    for (const match of input.normalized.matchAll(pattern)) {
      const start = match.index ?? 0;
      issues.push(
        issue(
          {
            start,
            end: start + match[0].length,
            kind: "spelling",
            severity: "medium",
            message: `Possible misspelling: "${match[0]}".`,
            suggestions,
            confidence: 0.82,
          },
          issues.length,
        ),
      );
    }
  }

  for (const match of input.normalized.matchAll(/\b([\p{L}\p{M}]{3,})\s+\1\b/giu)) {
    const start = match.index ?? 0;
    issues.push(
      issue(
        {
          start,
          end: start + match[0].length,
          kind: "typography",
          severity: "low",
          message: "Repeated adjacent word.",
          suggestions: [match[1]],
          confidence: 0.9,
        },
        issues.length,
      ),
    );
  }

  for (const match of input.normalized.matchAll(/[ \t]{2,}/gu)) {
    const start = match.index ?? 0;
    issues.push(
      issue(
        {
          start,
          end: start + match[0].length,
          kind: "typography",
          severity: "low",
          message: "Multiple consecutive spaces.",
          suggestions: ["Use a single space."],
          confidence: 0.92,
        },
        issues.length,
      ),
    );
  }

  for (const phrase of ["in order to", "due to the fact that", "at this point in time"]) {
    const pattern = new RegExp(`\\b${phrase}\\b`, "giu");
    for (const match of lower.matchAll(pattern)) {
      const start = match.index ?? 0;
      issues.push(
        issue(
          {
            start,
            end: start + match[0].length,
            kind: "style",
            severity: "low",
            message: "This phrase can usually be shorter.",
            suggestions: phrase === "in order to" ? ["to"] : phrase === "due to the fact that" ? ["because"] : ["now"],
            confidence: 0.66,
          },
          issues.length,
        ),
      );
    }
  }

  return {
    status: "available",
    language,
    providers,
    issues: issues.slice(0, 40),
    caveats: ["Full grammar checks run in the async analyzer path used by app surfaces."],
  };
}
