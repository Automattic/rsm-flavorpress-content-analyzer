# Agent Guide

This guide is for coding agents working on FlavorPress Content Analyzer.

## Project Status

This is an experimental local-first prototype from Automattic Radical Speed Month and Lucas and Matthias's FlavorPress initiative. It is provided as-is, without warranties. Keep that status visible in user-facing docs.

## First Files To Read

1. `README.md`
2. `docs/LOCAL_ONLY_GUARDRAILS.md`
3. `docs/DEVELOPMENT.md`
4. `docs/ANALYZER_CORE.md`
5. `docs/UI_ARCHITECTURE.md` for desktop UI work

## Non-Negotiable Guardrails

- Do not push branches.
- Do not create tags.
- Do not publish packages.
- Do not upload desktop artifacts.
- Do not submit the WordPress plugin.
- Do not open pull requests.
- Do not remove experimental or no-warranty language from README.
- Do not describe analyzer output as guaranteed, authoritative, or production-certified.

## Architecture Map

```text
packages/analyzer-core  -> canonical analyzer behavior
apps/cli                -> CLI wrapper around analyzer-core
apps/desktop            -> React/Tauri local UI around analyzer-core
plugins/wordpress       -> Gutenberg scaffold with generated shared-core browser bundle and local report storage
docs                    -> user, development, architecture, guardrail, and agent docs
```

Preferred direction of change:

- Put shared analysis logic in `packages/analyzer-core`.
- Keep CLI and desktop thin around the shared core.
- Regenerate the WordPress browser bundle when shared analyzer behavior changes.
- Keep network and publishing defaults conservative.

## Common Tasks

Analyzer changes:

- Edit `packages/analyzer-core/src/*`.
- Add or update tests in `tests/analyzer-core.test.mjs`.
- Check whether CLI output, desktop report display, README examples, or docs need updates.
- Run `pnpm test`.

CLI changes:

- Edit `apps/cli/src/index.ts`.
- Keep help text and README examples aligned.
- Add or update `tests/cli-smoke.test.mjs` when parsing or output behavior changes.
- Run `pnpm test`.

Desktop changes:

- Reuse primitives from `apps/desktop/src/ui.tsx`.
- Follow `docs/UI_ARCHITECTURE.md`.
- Keep reports session-only unless persistence is intentionally added.
- Run `pnpm --filter @flavorpress/desktop build`; run `pnpm desktop:build` for Tauri/Rust/package changes.

WordPress changes:

- Edit `plugins/wordpress/*`.
- Edit `plugins/wordpress/src/block.ts` for source changes and regenerate `plugins/wordpress/assets/block.js`.
- Keep the nested `wp-plugin-base` config release/deploy channels disabled unless a maintainer explicitly changes the local-only scope.
- Run `pnpm plugin:build`; run `pnpm plugin:zip` for packaging checks and test manually in a local WordPress editor when possible.

Documentation changes:

- Keep README as the GitHub-facing source of truth for status, warnings, quick start, and doc links.
- Keep deeper behavior in `docs/`.
- Run `pnpm scan:names`.

## Verification Commands

Use the narrowest relevant command while iterating:

```bash
pnpm scan:names
pnpm build
pnpm test
pnpm test:coverage
pnpm check:security
pnpm benchmark:analysis
pnpm --filter @flavorpress/analyzer-core type-check
pnpm --filter @flavorpress/desktop build
pnpm plugin:build
pnpm desktop:build
pnpm desktop:build:dmg
pnpm desktop:build:dmg:trusted
pnpm desktop:verify-dmg
pnpm plugin:zip
```

For a quick CLI smoke run after build:

```bash
pnpm cli analyze --text "This release note describes concrete editorial checks, source-review steps, and a clear publishing action for the team."
```

## Review Checklist Before Handoff

- Did the change preserve local-only behavior?
- Did it avoid publishing, pushing, or opening external artifacts?
- Did it keep analyzer-core as the source of truth?
- Did docs stay accurate for an uninformed user?
- Did README still present the project as experimental and no-warranty?
- Did tests or targeted checks run, or is any skipped verification clearly explained?

## Quality Focus Areas

- Keep multilingual, CMS-authored, formal, sourced, and short-text fixtures representative of current analyzer behavior.
- Preserve URL extraction safeguards whenever extraction quality changes.
- Keep desktop and WordPress screenshots current when UI behavior changes enough to make visual documentation useful.
