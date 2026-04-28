# Development Guide

This guide is for humans and coding agents working locally in the repository.

FlavorPress Content Analyzer is experimental and local-only. Do not push, publish, tag, submit, or open pull requests without explicit approval.

## Workspace Layout

```text
apps/
  cli/                 CLI wrapper around analyzer-core
  desktop/             React + Tauri desktop app
packages/
  analyzer-core/       Canonical analyzer implementation
plugins/
  wordpress/           Gutenberg block scaffold
docs/                  Documentation and project guardrails
scripts/               Local verification helpers
tests/                 Node test suite
```

## Prerequisites

- Node.js 22.12.0 or newer is required by `package.json`.
- pnpm 10.10.0 is pinned through `packageManager` in `package.json`.
- Rust, Cargo, and platform Tauri prerequisites for desktop work.
- A local WordPress 6.4+ and PHP 8.1+ environment for plugin testing.

## Core Commands

```bash
pnpm install
pnpm scan:names
pnpm build
pnpm test
pnpm test:coverage
pnpm check:security
pnpm check:quality
pnpm benchmark:analysis
pnpm deps:outdated
```

`pnpm test` runs:

1. `pnpm scan:names`
2. the WordPress committed-bundle freshness check
3. `pnpm build`
4. `node --test tests/*.test.mjs`
5. `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`

`pnpm test:coverage` applies analyzer-core coverage thresholds. `pnpm check:security` runs the npm audit and, when `cargo-audit` is installed, a Rust advisory audit for the Tauri package. `pnpm check:quality` runs coverage, security checks, the analyzer benchmark, and Tauri Rust tests. `pnpm benchmark:analysis` runs local budgets for large deterministic analysis, claim/source matching, mocked URL extraction, and async proofreading latency. `pnpm deps:outdated` lists outdated workspace dependencies without changing them.

## Surface Commands

CLI:

```bash
pnpm cli analyze --text "Paste a paragraph here."
pnpm --filter @flavorpress/cli build
```

Analyzer core:

```bash
pnpm --filter @flavorpress/analyzer-core build
pnpm --filter @flavorpress/analyzer-core type-check
```

Desktop:

```bash
pnpm desktop:dev
pnpm desktop:build
pnpm desktop:build:dmg
pnpm desktop:build:dmg:trusted
pnpm desktop:verify-dmg
pnpm desktop:verify-dmg:trusted
pnpm desktop:verify-shell
pnpm desktop:verify-binary
```

`pnpm desktop:verify-shell` checks the desktop shell wiring without requiring a release binary.
`pnpm desktop:verify-binary` expects `pnpm desktop:build:dmg` or another release build to have created `apps/desktop/src-tauri/target/release/flavorpress_content_analyzer_desktop`.
`pnpm desktop:verify-dmg` mounts generated DMGs read-only, checks the payload layout and architecture, and reports signing, Gatekeeper, and notarization status without requiring distribution trust.
`pnpm desktop:verify-dmg:trusted` uses the same checks but fails when the DMG is not accepted for trusted macOS distribution. Current local-only guardrails do not allow signing or notarizing desktop releases without explicit maintainer approval.

Installed DMG apps target macOS 11 or newer and should not require Node.js, pnpm, Rust, or Tauri on the user's Mac. Tauri embeds the built frontend assets and uses macOS system frameworks at runtime. LanguageTool remains an optional localhost-only integration and is not bundled.

`pnpm desktop:build:dmg:trusted` is the external-sharing path once signing and notarization are approved. It requires `FLAVORPRESS_APPROVE_DESKTOP_SIGNING=1`, a local `Developer ID Application` certificate, and either App Store Connect API credentials (`APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`) or Apple ID notarization credentials (`APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`). The command preflights approval and credentials, builds the DMG, then runs `pnpm desktop:verify-dmg:trusted`.

WordPress plugin:

```bash
pnpm plugin:build
pnpm plugin:zip
```

Only run packaging commands when relevant to the change.

## Source Of Truth

`packages/analyzer-core` is the source of truth for analysis behavior.

Expected dependency direction:

- CLI depends on analyzer-core.
- Desktop depends on analyzer-core.
- WordPress uses a generated analyzer-core browser bundle.
- analyzer-core should not depend on app surfaces.

The WordPress plugin source lives in `plugins/wordpress/src/block.ts` and bundles shared analyzer-core behavior into `plugins/wordpress/assets/block.js`. The installable plugin is treated as a nested `wp-plugin-base` child rooted at `plugins/wordpress`; release and deploy channels remain disabled. Regenerate the bundle after analyzer-core or WordPress changes.

## Change Workflow

1. Identify the owning surface.
2. Prefer changing shared analyzer behavior in `packages/analyzer-core` instead of duplicating logic in app surfaces.
3. Keep public request/result types stable unless the change intentionally updates the API.
4. Add or update tests for analyzer, CLI, or smoke behavior where the risk justifies it.
5. Update docs whenever user-facing behavior, commands, limitations, or architecture changes.
6. Run the narrowest useful verification, then `pnpm test` for broad handoff.

## Verification Matrix

| Change type | Minimum useful verification |
| --- | --- |
| Documentation only | `pnpm scan:names` |
| Analyzer behavior | `pnpm test` |
| CLI parsing/output | `pnpm test` plus a manual `pnpm cli analyze ...` example when behavior changed |
| Desktop React UI | `pnpm --filter @flavorpress/desktop build` |
| Desktop Tauri/Rust/network behavior | `pnpm desktop:build` |
| URL extraction safety | `pnpm test` plus `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` |
| Analyzer quality gates | `pnpm test:coverage`, `pnpm check:security`, `pnpm benchmark:analysis` |
| WordPress block | `pnpm plugin:build`, `pnpm plugin:zip`, and manual local editor testing |
| Package or workspace config | `pnpm install`, `pnpm build`, `pnpm test` as appropriate |

## Documentation Rules

- Keep experimental status and no-warranty language visible in README.
- Keep local-only restrictions linked from README and agent docs.
- Use accurate wording for current behavior. The WordPress browser bundle should stay aligned with analyzer-core behavior.
- Update examples when CLI options, request shape, or output behavior changes.
- Keep docs useful for an uninformed user first, then add deeper implementation details in `docs/`.

## Name Boundary Scan

`scripts/check-name-boundaries.mjs` blocks known legacy identifiers from entering source and docs. Run it before handoff:

```bash
pnpm scan:names
```

Do not remove blocked identifiers from the script without explicit maintainer approval.

## Dependency Policy

Prefer established dependencies already in the workspace. If a defect belongs to an upstream dependency we control, fix it upstream first and then consume the corrected release locally.

Copy/paste message for upstream-controlled issues:

```text
We are building the experimental FlavorPress Content Analyzer as part of Automattic Radical Speed Month. We found an issue that belongs in the shared upstream dependency rather than this downstream repository. Please fix it upstream first so this project can consume the corrected release cleanly.
```

## Release And Publishing

Publishing is intentionally out of scope for the current milestone. See `docs/LOCAL_ONLY_GUARDRAILS.md`.
