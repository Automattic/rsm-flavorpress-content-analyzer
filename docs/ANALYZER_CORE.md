# Analyzer Core Reference

`packages/analyzer-core` is the canonical implementation for FlavorPress content analysis. CLI and desktop use this package directly. The WordPress plugin builds a browser bundle from the text-only shared core entry.

## Public Entry Points

Defined in `packages/analyzer-core/src/index.ts`:

- `analyze(input)`: accepts text or URL requests and returns an `AnalysisResult`.
- `analyzeText(input, extraction?)`: analyzes supplied text synchronously with conservative local proofreading.
- `analyzeTextAsync(input, extraction?)`: analyzes supplied text with the bundled local grammar engine.
- `analyzeUrl(input)`: fetches a URL, extracts readable text, and analyzes it.
- `renderMarkdownReport(result)`: renders an `AnalysisResult` as Markdown. Use `renderClaimsCsv(result)` for claim CSV output.
- `buildReportView(result, profile)`: builds shared report sections for desktop, CLI, and WordPress.
- `renderClaimsCsv(result)`: renders claim review output as CSV.
- `isQualityDimension`, `isProvenanceDimension`, `dimensionKind`, and `overallQualityScore`: shared dimension metadata and scoring helpers for app surfaces.
- type exports from `packages/analyzer-core/src/types.ts`.

Defined in `packages/analyzer-core/src/browser.ts`:

- browser-safe text analysis exports for WordPress and other browser-only surfaces.
- excludes URL extraction and the larger Harper/WASM grammar-engine artifact.

## Pipeline

```text
AnalysisRequest
  -> URL extraction when request has url
  -> prepareText
  -> computeMetrics
  -> analyzeProvenanceSignals
  -> analyzeQuality
  -> analyzeClaims
  -> proofreadText for synchronous/browser-safe analysis
     or proofreadTextWithHarper for async CLI/desktop analysis
  -> AnalysisResult
  -> shared report view
  -> optional Markdown or CSV report
```

Implementation files:

| File | Responsibility |
| --- | --- |
| `src/types.ts` | Request, metadata, result, claim, span, metric, and band types. |
| `src/extract.ts` | Public URL normalization, fetch safety checks, HTML stripping, extraction confidence. |
| `src/preprocess.ts` | Text normalization, tokenization, language/genre hints, assumptions. |
| `src/metrics.ts` | Lexical, repetition, sentence, connector, formatting, citation, and URL metrics. |
| `src/dimensions.ts` | Shared dimension IDs, dimension family helpers, and overall quality scoring. |
| `src/provenance.ts` | Provenance-risk dimensions, caveats, confidence, and spans. |
| `src/quality.ts` | Editorial quality dimensions, recommendations, and spans. |
| `src/claims.ts` | Claim candidates and simple source-support checks. |
| `src/proofreading.ts` | Lightweight local English proofreading checks. |
| `src/proofreading-harper.ts` | Bundled async Harper proofreading path for app surfaces. |
| `src/report.ts` | Shared report-section builder plus Markdown and CSV renderers. |
| `src/registries.ts` | Shared phrase, language, and marker registries. |
| `src/index.ts` | Public API composition and Markdown rendering. |

## Request Shape

Text request:

```ts
{
  text: string;
  mode?: "editorial" | "integrity" | "research";
  metadata?: AnalysisMetadata;
  options?: AnalysisOptions;
}
```

URL request:

```ts
{
  url: string;
  mode?: "editorial" | "integrity" | "research";
  metadata?: AnalysisMetadata;
  options?: AnalysisOptions;
}
```

Metadata:

```ts
{
  languageHint?: string;
  locale?: string;
  genre?: "general" | "article" | "marketing" | "support" | "documentation" | "policy" | "legal" | "academic" | "corporate";
  goal?: "publish_ready_review" | "source_support" | "clarity_rewrite" | "risk_review" | "editorial_triage";
  audience?: string;
  channel?: string;
  purpose?: string;
  sources?: Array<string | SourceInput>;
}
```

Options:

```ts
{
  includeSpans?: boolean;
  includeRawMetrics?: boolean;
  allowPrivateNetwork?: boolean;
  reportProfile?: "full" | "checklist" | "claims-csv" | "machine";
  includeProofreading?: boolean;
  languageToolUrl?: string;
}
```

Keep `allowPrivateNetwork` disabled by default in user-facing surfaces.
Only pass `languageToolUrl` for an explicitly configured local LanguageTool server. The async analyzer accepts `localhost`, `127.0.0.1`, or `[::1]` URLs and rejects remote endpoints before making a request.

## Result Shape

The analyzer returns:

- `reportProfile` and `inputSummary`.
- `analysisSections`: shared report sections used by desktop, CLI, and WordPress, including an author-facing content-audit scorecard.
- `scoreContributions`: metric-level score provenance.
- `proofreading`: local provider manifests, status, caveats, and issues.
- `claimReview`: aggregate claim/source support counts and caveats.
- `context`: detected language, genre, word/sentence/paragraph counts, script, mixed-language status, assumptions, and optional extraction context.
- `summary`: provenance-risk band, confidence, quality band, source band, headline, caveats, and key points.
- `dimensions`: scored dimensions with findings, recommendations, and common false-positive contexts.
- `spans`: optional text spans for localized findings.
- `claims`: claim candidates with support status, support need, gaps, recommended action, notes, evidence, and freshness risk.
- `recommendations`: deduplicated edit suggestions.
- `rawMetrics`: present in research mode, when `includeRawMetrics` is true, or when `reportProfile` is `machine`.
- `generatedAt`: ISO timestamp.

## Bands

Provenance-risk bands:

- `low`
- `elevated`
- `high`
- `insufficient_evidence`

Quality bands:

- `poor`
- `fair`
- `good`
- `strong`

Source bands:

- `supported`
- `mixed`
- `weakly_supported`
- `not_checked`

These are review signals. They are not guarantees about authorship, truth, safety, or publishability.

## Mode Behavior

Modes are available for API stability and future tuning:

- `editorial`: default content review mode.
- `integrity`: provenance-risk-oriented mode.
- `research`: includes raw metrics by default.

Modes now apply conservative scoring profile differences. `integrity` slightly increases provenance-risk sensitivity, `research` includes raw metrics by default, and genre/profile context changes tolerance for naturally formal content. If future work changes mode-specific scoring, update this document, README examples, CLI help if needed, and tests.

## Review Focus

`metadata.goal` lets surfaces rank the same deterministic findings around the user's immediate job:

- `publish_ready_review`: balanced publishing-readiness checklist.
- `source_support`: prioritize unsupported, partially supported, and inline-citation-only claims.
- `clarity_rewrite`: prioritize writing quality and proofreading actions.
- `risk_review`: prioritize provenance-risk and time-sensitive claim caveats.
- `editorial_triage`: balanced first-pass review for editor workflows.

The focus changes report ordering and context labels. It does not suppress caveats or change the underlying local-only analysis contract.

## URL Extraction Safety

URL analysis:

- accepts only `http` and `https`,
- normalizes missing schemes to `https`,
- blocks private-network hosts by default before fetch, including DNS results that resolve to private or reserved addresses,
- rejects responses over 2 MB,
- rejects non-text/non-HTML content types,
- removes obvious page chrome, scores likely `article`/`main`/content containers, falls back to whole-page text when candidate scoring is weak,
- returns extraction confidence and notes.

The desktop app implements a parallel Rust/Tauri extraction path with the same intended safety posture. Keep the two paths aligned until extraction is centralized.

## Source Support

`metadata.sources` may contain:

- source URLs,
- citations,
- pasted source text,
- structured `SourceInput` objects.

The analyzer uses provided source text to mark simple claim support against provided material. Inline citations, source URLs, DOI strings, and `SourceInput.url`/`citation`/`title` values are treated as labels or citation presence, not proof of support. Use `SourceInput.text` or pasted source text when claim support should be checked locally. The analyzer does not independently determine factual truth and does not fetch source URLs for truth validation.

Claim status values are:

- `supported`
- `partially_supported`
- `inline_citation_only`
- `unsupported`
- `not_checked`

Claims also expose `supportNeed`, `supportGaps`, and `recommendedAction` so reports can explain what evidence is missing and what an editor should do next.

## Proofreading

Proofreading is local-only by default. CLI and desktop use the bundled Harper engine for English grammar, spelling, and style checks through `analyzeTextAsync`. Callers may add `options.languageToolUrl` to merge matches from a locally running LanguageTool server; this provider is disabled by default, declares `egress: "localhost_only"`, and refuses remote endpoints before fetch. The synchronous `analyzeText` API remains available for callers that need an immediate result and uses conservative local checks. WordPress imports the browser-safe entry and uses that synchronous fallback path so public bundles avoid Harper/WASM and LanguageTool paths.

## Change Checklist

When changing analyzer behavior:

- update or add focused tests in `tests/analyzer-core.test.mjs`,
- verify CLI behavior if request/result shape changes,
- update desktop report rendering if new result fields matter to users,
- regenerate the WordPress browser bundle if shared analyzer behavior changes,
- run `pnpm test`.
