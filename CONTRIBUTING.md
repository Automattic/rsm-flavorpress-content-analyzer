# Contributing

FlavorPress Content Analyzer is currently an experimental local prototype from Automattic Radical Speed Month and Lucas and Matthias's FlavorPress initiative. It is provided as-is, without warranties.

This repository is not yet open for normal public contribution flow. Do not open pull requests, publish packages, create release artifacts, or submit the WordPress plugin unless a maintainer explicitly approves that action.

For local development guidance, read:

- [Development guide](docs/DEVELOPMENT.md)
- [Local-only guardrails](docs/LOCAL_ONLY_GUARDRAILS.md)
- [Analyzer core reference](docs/ANALYZER_CORE.md)
- [Agent guide](docs/AGENT_GUIDE.md)

Before handoff, run the relevant checks. For most changes:

```bash
pnpm test
```

For documentation-only changes:

```bash
pnpm scan:names
```
