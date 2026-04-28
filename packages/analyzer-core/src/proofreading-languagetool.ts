import { selectedLanguage } from "./proofreading.js";
import type {
  AnalysisMetadata,
  PreparedText,
  ProofreadIssue,
  ProofreadingResult,
  ProviderManifest,
} from "./types.js";

const languageToolManifest: ProviderManifest = {
  id: "languagetool-local",
  label: "LanguageTool Local Server",
  capabilities: ["spelling", "grammar", "style", "punctuation", "typography"],
  supportedLanguages: ["en", "es", "pt", "fr", "de"],
  license: "External local service",
  egress: "localhost_only",
  spanSupport: true,
  confidenceSemantics: "Local LanguageTool rule matches. Confidence reflects rule category precision, not certainty.",
  enabledByDefault: false,
  notes: [
    "Runs only when a localhost LanguageTool URL is explicitly configured.",
    "Remote LanguageTool endpoints are rejected before any request is made.",
  ],
};

type LanguageToolReplacement = {
  value?: unknown;
};

type LanguageToolMatch = {
  message?: unknown;
  offset?: unknown;
  length?: unknown;
  replacements?: LanguageToolReplacement[];
  rule?: {
    issueType?: unknown;
    category?: {
      id?: unknown;
      name?: unknown;
    };
  };
};

type LanguageToolResponse = {
  matches?: LanguageToolMatch[];
};

function endpointFromUrl(value: string): URL {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  if (!["http:", "https:"].includes(url.protocol) || !isLocalhost) {
    throw new Error("LanguageTool proofreading only accepts localhost URLs.");
  }
  if (!url.pathname.endsWith("/v2/check")) {
    url.pathname = `${url.pathname.replace(/\/+$/u, "")}/v2/check`;
  }
  return url;
}

function languageFor(input: PreparedText, metadata?: AnalysisMetadata): string {
  const hint = metadata?.languageHint?.trim();
  if (hint) {
    return hint.slice(0, 5);
  }
  if (input.detectedLanguage !== "unknown" && input.detectedLanguage !== "unsupported") {
    return input.detectedLanguage === "en" ? "en-US" : input.detectedLanguage;
  }
  return "auto";
}

function kindForMatch(match: LanguageToolMatch): ProofreadIssue["kind"] {
  const issueType = String(match.rule?.issueType ?? "").toLowerCase();
  const category = `${String(match.rule?.category?.id ?? "")} ${String(match.rule?.category?.name ?? "")}`.toLowerCase();
  if (issueType.includes("misspelling") || category.includes("typo") || category.includes("spelling")) {
    return "spelling";
  }
  if (issueType.includes("grammar") || category.includes("grammar")) {
    return "grammar";
  }
  if (issueType.includes("typographical") || category.includes("typography") || category.includes("casing")) {
    return "typography";
  }
  if (issueType.includes("punctuation") || category.includes("punctuation")) {
    return "punctuation";
  }
  return "style";
}

function severityForKind(kind: ProofreadIssue["kind"]): ProofreadIssue["severity"] {
  return kind === "spelling" || kind === "grammar" ? "medium" : "low";
}

function confidenceForKind(kind: ProofreadIssue["kind"]): number {
  if (kind === "spelling") {
    return 0.82;
  }
  if (kind === "grammar") {
    return 0.76;
  }
  if (kind === "typography" || kind === "punctuation") {
    return 0.8;
  }
  return 0.66;
}

function issueFromMatch(match: LanguageToolMatch, index: number): ProofreadIssue | null {
  const start = typeof match.offset === "number" ? match.offset : Number.NaN;
  const length = typeof match.length === "number" ? match.length : Number.NaN;
  if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length <= 0) {
    return null;
  }
  const kind = kindForMatch(match);
  const suggestions = (Array.isArray(match.replacements) ? match.replacements : [])
    .map((replacement) => replacement.value)
    .filter((replacement): replacement is string => typeof replacement === "string" && replacement.length > 0)
    .slice(0, 5);

  return {
    id: `languagetool-${index + 1}`,
    start,
    end: start + length,
    kind,
    severity: severityForKind(kind),
    message: typeof match.message === "string" ? match.message : "LanguageTool reported a proofreading issue.",
    suggestions,
    source: languageToolManifest.id,
    confidence: confidenceForKind(kind),
  };
}

function mergeIssues(base: ProofreadingResult, additions: ProofreadIssue[]): ProofreadIssue[] {
  const merged = [...base.issues];
  for (const issue of additions) {
    if (!merged.some((entry) => entry.start === issue.start && entry.end === issue.end && entry.kind === issue.kind)) {
      merged.push(issue);
    }
  }
  return merged.slice(0, 60);
}

export async function augmentProofreadingWithLanguageTool(
  input: PreparedText,
  base: ProofreadingResult,
  languageToolUrl: string | undefined,
  metadata?: AnalysisMetadata,
): Promise<ProofreadingResult> {
  if (!languageToolUrl) {
    return base;
  }

  let endpoint: URL;
  try {
    endpoint = endpointFromUrl(languageToolUrl);
  } catch (error) {
    return {
      ...base,
      providers: [...base.providers, languageToolManifest],
      status: base.status === "disabled" ? "disabled" : "error",
      caveats: [
        ...base.caveats,
        error instanceof Error ? error.message : "LanguageTool URL was rejected.",
      ],
    };
  }

  const selected = selectedLanguage(input, metadata);
  const languageSupported =
    input.detectedLanguage !== "unsupported" &&
    (selected !== null || input.detectedLanguage === "unknown" || languageToolManifest.supportedLanguages.includes(input.detectedLanguage));
  if (!languageSupported) {
    return {
      ...base,
      providers: [...base.providers, languageToolManifest],
      caveats: [...base.caveats, "LanguageTool proofreading abstained because the language is unsupported."],
    };
  }

  try {
    const body = new URLSearchParams({
      text: input.normalized,
      language: languageFor(input, metadata),
      enabledOnly: "false",
    });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body,
    });
    if (!response.ok) {
      throw new Error(`LanguageTool request failed with HTTP ${response.status}.`);
    }
    const payload = (await response.json()) as LanguageToolResponse;
    const issues = (Array.isArray(payload.matches) ? payload.matches : [])
      .map((match, index) => issueFromMatch(match, index))
      .filter((issue): issue is ProofreadIssue => issue !== null)
      .slice(0, 40);

    return {
      ...base,
      status: base.status === "disabled" ? "disabled" : "available",
      providers: [...base.providers, languageToolManifest],
      issues: mergeIssues(base, issues),
    };
  } catch (error) {
    return {
      ...base,
      providers: [...base.providers, languageToolManifest],
      status: base.status === "disabled" ? "disabled" : base.status === "abstained" ? "abstained" : "error",
      caveats: [
        ...base.caveats,
        "LanguageTool proofreading could not run, so other local checks were used.",
        ...(error instanceof Error ? [error.message] : []),
      ],
    };
  }
}
