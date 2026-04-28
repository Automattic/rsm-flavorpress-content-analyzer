# Examples

These files are local fixtures for trying the CLI and understanding report shape.

## Files

- `request.json`: text-based `AnalysisRequest` with language, genre, audience, and source context.
- `url-request.json`: URL-based `AnalysisRequest` for public-page extraction.
- `sample-report.md`: illustrative Markdown report generated from `request.json`. Exact scores and wording may change as analyzer rules evolve.

## Run

```bash
pnpm cli analyze --input examples/request.json --output-dir reports
```

```bash
pnpm cli analyze --input examples/request.json --profile claims-csv --output-dir reports
```

```bash
pnpm cli analyze --input examples/url-request.json --output-dir reports --json
```

Generated `reports/` output is ignored by git.
