# FlavorPress Content Analyzer

FlavorPress Content Analyzer is an experimental, local-first toolkit for deterministic editorial content analysis. It currently exposes the same product idea through a shared TypeScript analyzer core, a CLI, a Tauri desktop app, and a WordPress block scaffold.

> **Experimental status**
>
> This repository is an experimental project created during Automattic Radical Speed Month. It is part of Lucas and Matthias's FlavorPress initiative. It is not a production service, a supported product, or a warranty-backed tool. Use it as a prototype and review every output with human judgment.
>
> **No warranty**
>
> The project is provided as-is, without any express or implied warranties about correctness, availability, fitness for a particular purpose, or future maintenance. The GPL license text also contains the formal no-warranty terms.

## What It Does

The analyzer reviews supplied content and produces a structured report with:

- editorial quality signals,
- a content-audit scorecard for plain-language load, scannability, reader value, evidence readiness, provenance review, and proofreading readiness,
- provenance-risk markers that may deserve human review,
- claim/source support bands when reference sources are provided,
- local English proofreading issues,
- review-focus profiles for publishing readiness, source support, clarity, risk, or balanced triage,
- score contributions and caveats for explainability,
- caveats for short text, mixed language, low-confidence extraction, and similar conditions,
- Markdown and JSON report output.

The analyzer is deterministic and rules-based. It is intended to support editorial review, not replace it.

## Top Creator Insights

For creators, the most useful outputs are:

1. **Is this draft ready for a reader?** The content audit groups plain-language load, scannability, reader value, evidence readiness, provenance review, and proofreading readiness into an author-facing checklist.
2. **Which claims need evidence before publishing?** Claim review lists factual claims, source-support status, freshness risk, support gaps, and recommended actions. Paste source excerpts when you want local support checks; URLs and citations alone are treated as reference labels.
3. **What should I fix first?** Review focus profiles reorder the same deterministic findings for publishing readiness, source support, clarity rewrites, risk review, or editorial triage.

## What It Does Not Do

- It is not an AI detector.
- It is not a factual truth engine.
- It does not guarantee that content is accurate, safe, compliant, or publishable.
- It does not provide legal, medical, financial, security, or policy advice.
- It does not currently publish packages, sign desktop releases, distribute a WordPress plugin package, or operate a hosted service.

## Repository Surfaces

| Surface | Path | Current role |
| --- | --- | --- |
| Analyzer core | `packages/analyzer-core` | Shared TypeScript package with request/result types, text preprocessing, scoring, claims analysis, URL extraction, and Markdown rendering. |
| CLI | `apps/cli` | Local command-line wrapper around the shared core. Writes JSON and Markdown reports. |
| Desktop app | `apps/desktop` | React + Tauri shell for local analysis, session-only report history, and report export. |
| WordPress plugin | `plugins/wordpress` | Gutenberg block scaffold with a browser bundle generated from the shared analyzer core and local WordPress report storage. |
| Docs | `docs` | User, development, architecture, guardrail, and agent documentation. |

## Requirements

- Node.js 22.12.0 or newer is required by `package.json`.
- pnpm 10.10.0 is pinned through `packageManager` in `package.json`.
- Rust and the Tauri prerequisites for desktop development or desktop packaging.
- WordPress 6.4+ and PHP 8.1+ only if testing the WordPress plugin scaffold.

## Quick Start

```bash
pnpm install
pnpm build
pnpm test
```

Run a CLI analysis from pasted text:

```bash
pnpm cli analyze --text "Paste at least a paragraph here."
```

Run a CLI analysis from a URL:

```bash
pnpm cli analyze --url https://example.com/
```

Write reports to a specific directory and emit NDJSON progress events:

```bash
pnpm cli analyze \
  --text "Paste the draft content here." \
  --source "The referenced release notes say the checklist supports editorial review teams." \
  --source "https://example.com/source" \
  --goal source_support \
  --output-dir reports \
  --json
```

Optionally add a local LanguageTool server for extra grammar/style matches:

```bash
pnpm cli analyze \
  --text "Paste the draft content here." \
  --languagetool-url http://localhost:8010
```

Only localhost LanguageTool URLs are accepted. Remote LanguageTool services are rejected before any request is made.

The CLI writes one `.json` file and one `.md` file per run. The default output directory is `content-analysis-output`.

Choose a report profile when needed:

```bash
pnpm cli analyze --input examples/request.json --profile checklist
pnpm cli analyze --input examples/request.json --profile claims-csv
```

Profiles are `full`, `checklist`, `claims-csv`, and `machine`. The `claims-csv` profile also writes a `.claims.csv` file; the `machine` profile includes raw metrics for local tooling.

## Request File Example

The CLI also accepts a JSON request. Save a request like this as `request.json`, or use the included `examples/request.json`.

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
    "includeRawMetrics": false
  }
}
```

Run it with:

```bash
pnpm cli analyze --input examples/request.json --output-dir reports
```

Use `url` instead of `text` to fetch and analyze a page. Private-network URLs are blocked by default unless the caller explicitly opts in through the programmatic API.

## Desktop App

Start the desktop development app:

```bash
pnpm desktop:dev
```

Build the desktop app locally:

```bash
pnpm desktop:build
```

Create a local macOS DMG for verification:

```bash
pnpm desktop:build:dmg
pnpm desktop:verify-dmg
```

Current DMGs are local development artifacts. They mount as drag-to-Applications images, but they are not signed, notarized, uploaded, or prepared as standalone installers for external macOS distribution.

The DMG app targets macOS 11 or newer. It does not require users to install Node.js, pnpm, Rust, or Tauri. The analyzer UI and local proofreading engine are bundled into the native app, and the app uses macOS system frameworks such as WebKit. The optional LanguageTool integration requires a separately running localhost LanguageTool server only when that setting is explicitly configured.

When signing and notarization are explicitly approved for external sharing, build a trusted DMG with:

```bash
pnpm desktop:build:dmg:trusted
```

That command requires a `Developer ID Application` certificate in the local keychain, plus either App Store Connect API credentials (`APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`) or Apple ID notarization credentials (`APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`).
It also requires `FLAVORPRESS_APPROVE_DESKTOP_SIGNING=1` so signing and notarization cannot run accidentally.

The desktop app can analyze pasted text or a URL. Reports are kept in memory for the current app session. Users can export selected reports as Markdown, claims CSV, or JSON. Desktop URL extraction blocks localhost and private-network hosts, including hostnames that resolve to private or reserved addresses.

## WordPress Plugin Scaffold

The WordPress plugin lives in `plugins/wordpress`. It registers a Gutenberg block named `flavorpress/content-analyzer`.

Current state:

- suitable for local experimentation in a development WordPress site,
- renders a public frontend text-analysis form through the block,
- adds a block-editor sidebar action for analyzing the current draft,
- stores report history in a private WordPress database table for administrators,
- stores browser-generated report snapshots; the WordPress server sanitizes and stores them but does not recompute or certify the analysis,
- stores full raw input text and client-supplied free-text report details only when a site administrator opts in,
- stores salted input, visitor, and user-agent hashes for duplicate detection, rate limiting, and admin history,
- uses a browser bundle generated from the canonical `packages/analyzer-core/browser` entry,
- uses a nested `wp-plugin-base` packaging foundation with release and deploy channels disabled,
- not prepared for WordPress.org submission or external distribution.

Create a local zip only when needed:

```bash
pnpm plugin:zip
```

## Programmatic Usage

After building the workspace, TypeScript or Node callers can use the shared core directly:

```ts
import { analyze, renderMarkdownReport } from "@flavorpress/analyzer-core";

const result = await analyze({
  text: "Paste content here.",
  mode: "editorial",
  metadata: {
    languageHint: "en",
    genre: "article",
    goal: "source_support",
    sources: [
      {
        url: "https://example.com/source",
        text: "Paste the relevant source excerpt here if you want claim support checked."
      }
    ],
  },
  options: {
    includeSpans: true,
  },
});

console.log(renderMarkdownReport(result));
```

Modes are `editorial`, `integrity`, and `research`. `research` includes raw metrics by default.

Reports include `summary`, `dimensions`, `spans`, `claims`, `recommendations`, `analysisSections`, `scoreContributions`, `proofreading`, and `claimReview`.

## Important Limitations

- URL extraction is intentionally simple and may miss page content hidden behind scripts, paywalls, redirects, or unusual markup.
- Language support is strongest for the languages listed in `packages/analyzer-core/src/types.ts`; unsupported or mixed-language text reduces confidence.
- Source support is based on provided source text and local heuristics. URLs and citations are treated as reference labels or citation-presence signals unless relevant source text is also provided; the analyzer does not independently determine factual truth.
- CLI and desktop proofreading can run local English checks through the bundled Harper engine. CLI callers can also opt into a locally running LanguageTool server with `--languagetool-url`; only localhost endpoints are accepted. Browser-only surfaces such as the WordPress plugin use conservative fallback proofreading so the public bundle avoids the large grammar-engine artifact.
- Short text may produce an `insufficient_evidence` provenance band.
- The desktop report history is session-only.
- Publishing, hosted services, signing, auto-update, package releases, and WordPress.org distribution are out of scope until explicitly approved.

## Documentation Map

- [User guide](docs/USER_GUIDE.md): practical usage for CLI, desktop, WordPress, request files, outputs, and troubleshooting.
- [Analyzer core reference](docs/ANALYZER_CORE.md): pipeline, request/result shape, modes, and implementation notes.
- [Development guide](docs/DEVELOPMENT.md): workspace setup, commands, code ownership, and change workflow.
- [Agent guide](docs/AGENT_GUIDE.md): repository-specific instructions for coding agents.
- [Root agent instructions](AGENTS.md): first-stop instructions for coding agents that honor repository-local guidance.
- [Local-only guardrails](docs/LOCAL_ONLY_GUARDRAILS.md): actions that require explicit approval.
- [UI architecture](docs/UI_ARCHITECTURE.md): desktop UI contracts and design constraints.
- [Standalone launch plan](docs/STANDALONE_LAUNCH_PLAN.md): local milestone scope and verification posture.
- [Examples](examples): ready-to-run CLI request files and an illustrative Markdown report.

## Local-Only Project Rules

Until explicit approval is given, do not push branches, create tags, publish packages, upload artifacts, submit the WordPress plugin, or open pull requests. Keep work local and verify it with local commands.

Before any handoff, run:

```bash
pnpm test
```

For narrower checks:

```bash
pnpm scan:names
pnpm build
pnpm test:coverage
pnpm check:security
pnpm benchmark:analysis
pnpm cli analyze --text "This release note describes a concrete workflow, a supporting source, and a clear next step for editors."
```

## License

This project is licensed under GPL-3.0-or-later. See [LICENSE](LICENSE).
