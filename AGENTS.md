# AGENTS.md

These instructions apply to this repository.

FlavorPress Content Analyzer is an experimental local-first prototype created during Automattic Radical Speed Month and part of Lucas and Matthias's FlavorPress initiative. It is provided as-is, without warranties.

## Required Context

Before making changes, read:

- `README.md`
- `docs/LOCAL_ONLY_GUARDRAILS.md`
- `docs/DEVELOPMENT.md`
- `docs/AGENT_GUIDE.md`

For analyzer behavior, also read `docs/ANALYZER_CORE.md`.
For desktop UI changes, also read `docs/UI_ARCHITECTURE.md`.

## Guardrails

- Do not push branches.
- Do not create tags.
- Do not publish packages.
- Do not upload desktop artifacts.
- Do not submit the WordPress plugin.
- Do not open pull requests.
- Do not remove experimental/no-warranty/Radical Speed Month/FlavorPress context from README.
- Do not describe analysis results as guaranteed, certified, or production-ready.

## Architecture Rules

- `packages/analyzer-core` is the canonical analyzer implementation.
- CLI and desktop should stay thin around analyzer-core.
- The WordPress block uses a generated analyzer-core browser bundle and local WordPress report storage; regenerate it when shared analyzer behavior changes.
- Keep private-network URL fetching disabled by default in user-facing surfaces.
- Preserve local-only behavior unless explicitly approved by a maintainer.

## Verification

For most changes, run:

```bash
pnpm test
```

For documentation-only changes, at minimum run:

```bash
pnpm scan:names
```

Use targeted checks from `docs/DEVELOPMENT.md` when they better match the changed surface.
