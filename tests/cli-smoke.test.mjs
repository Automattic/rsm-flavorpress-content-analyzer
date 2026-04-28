import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("CLI writes JSON and Markdown reports", () => {
  const outputDir = mkdtempSync(join(tmpdir(), "fpca-cli-"));
  const result = spawnSync(
    process.execPath,
    [
      "apps/cli/dist/index.js",
      "analyze",
      "--text",
      "This release note describes three specific editorial checks, two source-review steps, and one clear publishing action for the team. The editor should review the source evidence before publishing.",
      "--output-dir",
      outputDir,
      "--json",
    ],
    {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const completed = result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find((entry) => entry.type === "analysis.completed");
  assert.ok(completed);
  assert.match(readFileSync(completed.data.markdownPath, "utf8"), /Content Analysis Report/);
  assert.match(readFileSync(completed.data.jsonPath, "utf8"), /"summary"/);
});

test("CLI prints top-level help", () => {
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", "--help"], {
    cwd: new URL("..", import.meta.url).pathname,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /FlavorPress Content Analyzer/);
  assert.match(result.stdout, /flavorpress-content analyze/);
  assert.match(result.stdout, /--languagetool-url/);
});

test("CLI writes claims CSV profile", () => {
  const outputDir = mkdtempSync(join(tmpdir(), "fpca-cli-claims-"));
  const result = spawnSync(
    process.execPath,
    [
      "apps/cli/dist/index.js",
      "analyze",
      "--text",
      "Acme Analytics launched in 2024 and supports editorial workflows for review teams. Editors should review current source support before publishing.",
      "--source",
      "Acme Analytics supports editorial workflows for review teams.",
      "--profile",
      "claims-csv",
      "--output-dir",
      outputDir,
      "--json",
    ],
    {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const completed = result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find((entry) => entry.type === "analysis.completed");
  assert.ok(completed.data.csvPath);
  const csv = readFileSync(completed.data.csvPath, "utf8");
  assert.match(csv, /supportCoverage/);
  assert.match(csv, /recommendedAction/);
  assert.match(csv, /Acme Analytics launched in 2024/);
  assert.match(csv, /source-1|unsupported|partially_supported|supported/);
});

test("CLI rejects ambiguous input sources", () => {
  const result = spawnSync(
    process.execPath,
    [
      "apps/cli/dist/index.js",
      "analyze",
      "--text",
      "This release note describes a concrete editorial workflow for local validation.",
      "--url",
      "https://example.com/",
    ],
    {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exactly one of --input, --text, or --url/);
});

test("CLI input files accept explicit mode, profile, and source overrides", () => {
  const outputDir = mkdtempSync(join(tmpdir(), "fpca-cli-input-"));
  const inputPath = join(outputDir, "request.json");
  writeFileSync(
    inputPath,
    JSON.stringify({
      text: "Acme Analytics has 75 percent market share in Switzerland.",
      metadata: {
        languageHint: "en",
      },
    }),
    "utf8",
  );
  const result = spawnSync(
    process.execPath,
    [
      "apps/cli/dist/index.js",
      "analyze",
      "--input",
      inputPath,
      "--mode",
      "research",
      "--profile",
      "machine",
      "--source",
      "Acme Analytics supports editorial workflows.",
      "--output-dir",
      outputDir,
      "--json",
    ],
    {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const completed = result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find((entry) => entry.type === "analysis.completed");
  const json = JSON.parse(readFileSync(completed.data.jsonPath, "utf8"));
  assert.ok(json.rawMetrics);
  assert.equal(json.inputSummary.sourceCount, 1);
});

test("CLI rejects invalid enum flag values", () => {
  const result = spawnSync(
    process.execPath,
    [
      "apps/cli/dist/index.js",
      "analyze",
      "--text",
      "This release note describes a concrete editorial workflow for local validation.",
      "--profile",
      "bogus",
    ],
    {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid --profile 'bogus'/);
});

test("CLI keeps private-network URL fetching disabled", () => {
  const source = readFileSync(new URL("../apps/cli/src/index.ts", import.meta.url), "utf8");

  assert.match(source, /function forcePublicUrlFetching/);
  assert.match(source, /allowPrivateNetwork: false/);
});
