# Local-Only Guardrails

FlavorPress Content Analyzer is currently a local experimental prototype. Keep all work local unless Lucas, Matthias, or an explicitly authorized maintainer approves a broader release action.

These guardrails apply to humans and coding agents.

## Do Not Do Without Explicit Approval

- do not push any branch,
- do not create tags,
- do not publish npm packages,
- do not upload desktop artifacts,
- do not sign or notarize desktop releases,
- do not submit a WordPress plugin package,
- do not open pull requests,
- do not announce the project as production-ready,
- do not describe analysis results as guaranteed, certified, or authoritative.

## Allowed Local Actions

- install dependencies with `pnpm install`,
- run local builds and tests,
- run the CLI against local text, request files, and public URLs,
- run the desktop app locally,
- create local desktop build artifacts for verification,
- create a local WordPress plugin zip for development testing,
- edit documentation, source, tests, and examples in the working tree.

## Network Behavior

The analyzer can fetch public `http` and `https` URLs for URL analysis. Private-network URLs are blocked by default in the shared core and desktop URL extraction path.

Do not change that default casually. URL fetchers must check both the submitted hostname and resolved DNS addresses before fetching. If a future use case needs private-network fetches, document the reason, the caller, and the safety controls.

## Verification Before Handoff

For most changes, run:

```bash
pnpm test
```

For targeted verification:

```bash
pnpm scan:names
pnpm build
pnpm test:coverage
pnpm check:security
pnpm benchmark:analysis
pnpm plugin:build
pnpm desktop:build
pnpm plugin:zip
```

Only run the desktop or plugin packaging commands when they are relevant to the change.

The current handoff target is a working local codebase, not a published project.
