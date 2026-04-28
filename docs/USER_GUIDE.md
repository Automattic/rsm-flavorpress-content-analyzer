# User Guide

FlavorPress Content Analyzer is an experimental local-first prototype. It helps editors review content for quality, provenance-risk markers, and source-support signals. It does not guarantee correctness and should not be used as the only basis for publishing decisions.

## Top Creator Insights

The most useful creator-facing questions are:

1. **Is this draft ready for a reader?** Use the content audit to check plain-language load, scannability, reader value, evidence readiness, provenance review, and proofreading readiness.
2. **Which claims need evidence before publishing?** Use claim review to find factual claims, unsupported or partially supported wording, inline-citation-only claims, freshness risk, and recommended source actions.
3. **What should I fix first?** Choose a review focus so top actions match the current job: publishing readiness, source support, clarity rewrite, risk review, or editorial triage.

## Choose A Surface

| Use case | Recommended surface |
| --- | --- |
| Run repeatable local checks from scripts or a terminal | CLI |
| Review drafts interactively and export reports | Desktop app |
| Experiment inside a local WordPress editor or frontend form | WordPress plugin scaffold |
| Integrate analyzer behavior into another local tool | `packages/analyzer-core` |

## Setup

Install dependencies and verify the workspace:

```bash
pnpm install
pnpm test
```

`pnpm test` runs the name-boundary scan, builds the workspace, and executes the Node test suite.

## CLI Usage

Run pasted text:

```bash
pnpm cli analyze --text "Paste at least a paragraph of content here."
```

Run a URL:

```bash
pnpm cli analyze --url https://example.com/
```

Run with reference sources:

```bash
pnpm cli analyze \
  --text "The draft says the product launched in 2024 and supports editorial workflows." \
  --goal source_support \
  --source "The product supports editorial workflows for review teams." \
  --source "https://example.com/reference"
```

URLs and citations passed through `--source` are recorded as reference labels or citation-presence signals. Paste the relevant source excerpt, or use `SourceInput.text` in JSON, when you want the analyzer to check claim support locally.

Run from a JSON request file:

```bash
pnpm cli analyze --input examples/request.json --output-dir reports
```

Write a checklist-style report or claims CSV:

```bash
pnpm cli analyze --input examples/request.json --profile checklist
pnpm cli analyze --input examples/request.json --profile claims-csv
```

See `examples/sample-report.md` for an illustrative Markdown report generated from that request.

Emit NDJSON status events for automation:

```bash
pnpm cli analyze --input examples/request.json --json
```

CLI options:

| Option | Purpose |
| --- | --- |
| `--text <text>` | Analyze pasted text. |
| `--url <url>` | Fetch and analyze a public `http` or `https` URL. |
| `--input <path>` | Read an `AnalysisRequest` JSON file. |
| `--mode <mode>` | Select `editorial`, `integrity`, or `research`. |
| `--goal <goal>` | Rank report actions for `publish_ready_review`, `source_support`, `clarity_rewrite`, `risk_review`, or `editorial_triage`. |
| `--profile <profile>` | Select `full`, `checklist`, `claims-csv`, or `machine`. |
| `--languagetool-url <url>` | Add optional grammar/style checks from a local LanguageTool server. Only localhost URLs are accepted. |
| `--source <value>` | Add a reference URL/citation label or source text. Only source text is checked for claim support. Repeatable. |
| `--output-dir <path>` | Write report files to a directory. Defaults to `content-analysis-output`. |
| `--json` | Emit NDJSON progress/completion events. |
| `--help` | Print CLI help. |

The CLI always writes both a JSON report and a Markdown report. The `claims-csv` profile also writes a `.claims.csv` file.

Optional LanguageTool checks:

```bash
pnpm cli analyze \
  --text "Paste at least a paragraph of content here." \
  --languagetool-url http://localhost:8010
```

The LanguageTool integration is opt-in, disabled by default, and localhost-only. Remote endpoints such as public SaaS LanguageTool APIs are rejected before any network request is made.

## Request JSON

A text request:

```json
{
  "text": "Paste article, documentation, support, or policy content here.",
  "mode": "editorial",
  "metadata": {
    "languageHint": "en",
    "genre": "article",
    "audience": "customers",
    "goal": "publish_ready_review",
    "sources": [
      {
        "url": "https://example.com/reference",
        "text": "The cited source text can be pasted here for local support checks."
      }
    ]
  },
  "options": {
    "includeSpans": true,
    "includeRawMetrics": false,
    "includeProofreading": true
  }
}
```

A URL request:

```json
{
  "url": "https://example.com/",
  "mode": "research",
  "metadata": {
    "languageHint": "en",
    "genre": "article",
    "goal": "risk_review"
  },
  "options": {
    "includeSpans": true,
    "includeRawMetrics": true
  }
}
```

Private-network URL fetching is disabled by default. URL fetchers check both the submitted hostname and resolved DNS addresses before fetching. HTML URL extraction removes obvious page chrome, prefers likely article/main content, falls back to whole-page text when candidate scoring is weak, and reports extraction confidence. The programmatic API has an `allowPrivateNetwork` option, but local surfaces should keep it disabled unless a maintainer approves a documented exception.

Supported language hints are `en`, `es`, `pt`, `fr`, and `de`. Other language values are treated as unsupported or lower-confidence hints.

## Modes

- `editorial`: default mode for content quality and publishing-readiness review.
- `integrity`: intended for provenance-risk review. It slightly increases sensitivity while preserving conservative escalation rules.
- `research`: includes raw metrics by default for debugging and analysis.

Mode behavior is intentionally conservative in this prototype. Do not assume a mode provides a full policy workflow.

## Review Focus

Use review focus when you know the immediate editorial job:

- `publish_ready_review`: balanced publishing-readiness review.
- `source_support`: put claim/source actions first.
- `clarity_rewrite`: put clarity, proofreading, and rewrite actions first.
- `risk_review`: put provenance-risk and time-sensitive caveats first.
- `editorial_triage`: balanced first-pass review.

Review focus changes report priority order. It does not turn the analyzer into a factual verifier, authorship verdict, or policy approval system.

## Report Profiles

- `full`: all shared report sections.
- `checklist`: top actions, content audit, claim review, proofreading, and caveats.
- `claims-csv`: claim review as CSV plus normal JSON/Markdown files.
- `machine`: raw diagnostics-oriented output for local tooling. This profile includes raw metrics even outside `research` mode.

## Desktop Usage

Start the desktop app locally:

```bash
pnpm desktop:dev
```

Build the desktop app locally:

```bash
pnpm desktop:build
```

Create and inspect a local macOS DMG:

```bash
pnpm desktop:build:dmg
pnpm desktop:verify-dmg
```

The generated DMG is for local verification. It is not currently signed, notarized, uploaded, or prepared as a standalone installer for external macOS distribution.

The DMG app targets macOS 11 or newer. It does not require Node.js, pnpm, Rust, or Tauri on the user's Mac. The analyzer UI and bundled local proofreading engine are packaged into the native app. The optional LanguageTool setting only works when the user separately runs a localhost LanguageTool server.

Trusted external DMGs are built with `pnpm desktop:build:dmg:trusted` after signing and notarization are explicitly approved and Apple Developer credentials are available. The command also requires `FLAVORPRESS_APPROVE_DESKTOP_SIGNING=1` to avoid accidental signing or notarization.

Desktop workflow:

1. Click **New analysis** in the header.
2. Choose Text or URL.
3. Paste content or enter a URL.
4. Optionally open Advanced context and choose a review focus, genre, or reference sources.
5. Run content analysis.
6. Review the generated report on the Reports page. In-progress analyses remain in the report list.
7. Export Markdown, claims CSV, or JSON if needed.

Desktop reports are kept in memory for the current session. Closing the app clears them. Settings include an optional LanguageTool localhost URL for extra local grammar/style checks; leave it blank unless a local LanguageTool server is running.

## WordPress Plugin Scaffold

The plugin is in `plugins/wordpress` and registers the `flavorpress/content-analyzer` block.

Local testing flow:

1. Run `pnpm plugin:build`.
2. Copy or symlink `plugins/wordpress` into a local WordPress site's `wp-content/plugins` directory.
3. Activate "FlavorPress Content Analyzer" in the local WordPress admin.
4. Add the "Content Analyzer" block to a post or page to render a public frontend analysis form with local language, genre, and review-focus controls.
5. Use the block-editor "Content Analyzer" sidebar action to analyze the current draft with mode, language, genre, and review focus.
6. Review stored reports in **WP Admin > Content Analyzer**.

The WordPress bundle is generated from the shared analyzer core browser entry and uses conservative browser-safe local proofreading. Frontend visitors see only their latest report in the current page session. Site administrators can see stored report history in WordPress admin. Stored reports are browser-generated snapshots; WordPress sanitizes and stores them but does not recompute or certify the analysis server-side. Full raw input text, source-related report details, excerpts, claim text, highlighted passages, detailed proofreading items, claim-specific recommendations, and other client-supplied free-text report details are not stored unless an administrator enables raw text storage for future reports. Stored reports still keep salted input, visitor IP plus user-agent, and user-agent hashes for duplicate detection, rate limiting, and admin history until an administrator deletes the reports.

WordPress settings and limits:

- Public frontend submissions are enabled by default.
- Frontend input is limited to 20,000 characters.
- Frontend submissions are limited to 10 per visitor per hour and 100 per site per day.
- Duplicate frontend submissions are reused for 1 hour.
- Stored reports remain in the local WordPress database until an administrator deletes them.

Create a local development zip:

```bash
pnpm plugin:zip
```

Do not submit the plugin to WordPress.org or distribute the zip without explicit approval.

## Reading Reports

The report contains:

- summary headline,
- provenance-risk band,
- quality band,
- source band,
- content-audit scorecards for plain-language load, scannability, reader value, evidence readiness, provenance review, and proofreading readiness,
- caveats,
- top actions,
- writing-quality and provenance-risk sections,
- local proofreading issues,
- claim candidates with provided-material support status, support gaps, and recommended actions,
- recommended edits,
- optional raw metrics.

Band values are directional review signals. Treat them as prompts for human inspection, not as final judgments.

## Troubleshooting

| Symptom | Likely cause | What to try |
| --- | --- | --- |
| `Pass --input, --text, or --url.` | The CLI command has no content source. | Add one of `--text`, `--url`, or `--input`. |
| `Private-network URLs are disabled by default.` | The URL points to localhost or a private network. | Use pasted text for local content, or document a deliberate API-level exception. |
| `URL response is too large.` | The fetched response exceeds the 2 MB safety limit. | Paste the relevant content directly or use a shorter source. |
| Low extraction confidence | The fetched page yielded little readable text. | Review the page manually or paste the article body. |
| `insufficient_evidence` provenance band | The content is too short for meaningful provenance-risk scoring. | Analyze a longer draft or treat the result as abstained. |
| `LanguageTool proofreading only accepts localhost URLs.` | A remote or non-HTTP LanguageTool endpoint was configured. | Run LanguageTool locally and use a `localhost`, `127.0.0.1`, or `[::1]` URL. |

## Safety Expectations

- Do not send sensitive unpublished content to third-party services through this project.
- Do not publish results as guarantees.
- Do not remove the experimental and no-warranty language from user-facing docs.
- Keep local-only guardrails in mind when creating artifacts.
