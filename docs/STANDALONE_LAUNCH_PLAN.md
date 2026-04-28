# Standalone Launch Plan

## Project Context

FlavorPress Content Analyzer is an experimental local-first project from Automattic Radical Speed Month and part of Lucas and Matthias's FlavorPress initiative.

The repository starts from a clean implementation and preserves only the product idea: local content analysis for editorial quality, source support, and provenance-risk signals. It does not import the former application shell, auth, sync, website crawling, release automation, telemetry, or legacy product identity.

The project is provided as-is, without warranties. It should be presented as a prototype until a maintainer explicitly changes that status.

## Current Local Milestone

The current milestone is a local repository that can:

- run shared content analysis from TypeScript,
- expose the analyzer through a CLI,
- build a Tauri desktop shell with the analyzer available in-app,
- provide a WordPress plugin scaffold with a Gutenberg block,
- run tests and a local naming-boundary scan,
- give humans and coding agents enough documentation to use and change the project safely,
- stay local-only until explicit publishing approval.

## Architecture

- `packages/analyzer-core`: canonical analyzer implementation, URL extraction, claim/source matching, local proofreading, shared report rendering, and exported request/result types.
- `apps/cli`: thin argument parser around the shared core; emits profile-based Markdown reports, JSON report files, claims CSV, and optional NDJSON events.
- `apps/desktop`: React + Tauri app using the shared core in the renderer for text analysis and a Tauri command for desktop URL extraction.
- `plugins/wordpress`: Gutenberg block, editor sidebar, local report storage, admin report history, and a browser bundle generated from the shared core.
- `docs`: onboarding, guardrails, architecture notes, and agent instructions.

## Current Documentation Baseline

- `README.md` is the GitHub-facing entry point and must keep the experimental/no-warranty/Radical Speed Month/FlavorPress context visible near the top.
- `docs/USER_GUIDE.md` explains how an uninformed local user can run the CLI, desktop app, and WordPress scaffold.
- `docs/DEVELOPMENT.md` explains setup, commands, change workflow, and verification.
- `docs/ANALYZER_CORE.md` explains request/result shapes and the analyzer pipeline.
- `docs/AGENT_GUIDE.md` and root `AGENTS.md` make coding-agent expectations explicit.
- `docs/LOCAL_ONLY_GUARDRAILS.md` defines the local-only boundary.
- `docs/UI_ARCHITECTURE.md` defines desktop UI contracts.

## Local Completion Posture

The local milestone is treated as complete when these checks pass:

- the repository remains local-only, with no pushed branches, tags, published packages, uploaded release artifacts, WordPress submissions, or pull requests;
- `pnpm scan:names` passes before any handoff or distribution package;
- README keeps the experimental status, no-warranty language, Radical Speed Month context, and FlavorPress ownership context visible;
- shared-core tests, CLI smoke coverage, desktop builds, and WordPress packaging checks pass locally;
- the WordPress generated browser bundle imports the shared browser text analyzer and conservative browser-safe local proofreading path, without the larger Harper grammar-engine artifact;
- fixtures cover the current supported behaviors for short text, formal prose, sourced claims, URL safety, and proofreading;
- generated reports stay human-review signals and do not claim authorship certainty, factual truth, production approval, or legal/compliance guarantees.

## Upstream Note

No upstream dependency fix is required for the current local milestone. If a defect appears in a dependency we control, the preferred message is:

> We are building the experimental FlavorPress Content Analyzer as part of Automattic Radical Speed Month. We found an issue that belongs in the shared upstream dependency rather than this downstream repository. Please fix it upstream first so this project can consume the corrected release cleanly.
