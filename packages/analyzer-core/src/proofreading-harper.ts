import { LocalLinter, type Lint } from "harper.js";
import { slimBinaryInlined } from "harper.js/slimBinaryInlined";
import { basicEnglishManifest, issue, proofreadText, selectedLanguage } from "./proofreading.js";
import type {
  AnalysisMetadata,
  PreparedText,
  ProofreadIssue,
  ProofreadingResult,
  ProviderManifest,
} from "./types.js";

const harperManifest: ProviderManifest = {
  id: "harper-js",
  label: "Harper.js",
  capabilities: ["spelling", "grammar", "style"],
  supportedLanguages: ["en"],
  license: "Apache-2.0",
  egress: "none",
  artifactSizeBytes: 23_874_962,
  spanSupport: true,
  confidenceSemantics: "Local rule-based grammar and spelling checks. Confidence reflects rule precision, not certainty.",
  enabledByDefault: true,
  notes: ["Runs locally through the bundled Harper WebAssembly engine.", "Does not call external services."],
};

let harperLinterPromise: Promise<LocalLinter> | undefined;

function getHarperLinter(): Promise<LocalLinter> {
  harperLinterPromise ??= (async () => {
    const linter = new LocalLinter({ binary: slimBinaryInlined });
    await linter.setup();
    return linter;
  })();
  return harperLinterPromise;
}

function kindForLint(lint: Lint): ProofreadIssue["kind"] {
  const kind = lint.lint_kind_pretty().toLowerCase();
  if (kind.includes("spell")) {
    return "spelling";
  }
  if (kind.includes("punct")) {
    return "punctuation";
  }
  if (kind.includes("grammar")) {
    return "grammar";
  }
  if (kind.includes("repetition") || kind.includes("capital")) {
    return "typography";
  }
  return "style";
}

function severityForLint(lint: Lint): ProofreadIssue["severity"] {
  const kind = kindForLint(lint);
  if (kind === "spelling" || kind === "grammar") {
    return "medium";
  }
  return "low";
}

function confidenceForLint(lint: Lint): number {
  const kind = kindForLint(lint);
  if (kind === "spelling") {
    return 0.84;
  }
  if (kind === "grammar") {
    return 0.76;
  }
  if (kind === "typography" || kind === "punctuation") {
    return 0.82;
  }
  return 0.68;
}

function suggestionsForLint(lint: Lint): string[] {
  return lint
    .suggestions()
    .map((suggestion) => suggestion.get_replacement_text())
    .filter((suggestion) => suggestion.length > 0)
    .slice(0, 5);
}

function harperIssue(lint: Lint, index: number): ProofreadIssue {
  const span = lint.span();
  return issue(
    {
      start: span.start,
      end: span.end,
      kind: kindForLint(lint),
      severity: severityForLint(lint),
      message: lint.message(),
      suggestions: suggestionsForLint(lint),
      confidence: confidenceForLint(lint),
    },
    index,
    harperManifest.id,
  );
}

export async function proofreadTextWithHarper(input: PreparedText, metadata?: AnalysisMetadata): Promise<ProofreadingResult> {
  const providers = [harperManifest, basicEnglishManifest];
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

  try {
    const linter = await getHarperLinter();
    const harperIssues = (await linter.lint(input.normalized, { language: "plaintext" }))
      .map((lint, index) => harperIssue(lint, index))
      .slice(0, 40);
    const supplementalIssues = proofreadText(input, metadata).issues.filter(
      (entry) => !harperIssues.some((harperEntry) => harperEntry.start === entry.start && harperEntry.end === entry.end),
    );

    return {
      status: "available",
      language,
      providers,
      issues: [...harperIssues, ...supplementalIssues].slice(0, 40),
      caveats: [],
    };
  } catch (error) {
    const conservativeResult = proofreadText(input, metadata);
    return {
      ...conservativeResult,
      providers,
      caveats: [
        "Harper proofreading could not run, so conservative local checks were used.",
        ...(error instanceof Error ? [error.message] : []),
      ],
    };
  }
}
