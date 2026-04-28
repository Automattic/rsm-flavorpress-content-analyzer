import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { qualityBands, signalBands, sourceBands } = await import("../packages/analyzer-core/dist/index.js");

test("WordPress bundle uses the browser-safe local analyzer", () => {
  const bundleUrl = new URL("../plugins/wordpress/assets/block.js", import.meta.url);
  const bundle = readFileSync(bundleUrl, "utf8");

  assert.doesNotMatch(bundle, /extractTextFromUrl|analyzeUrl|allowPrivateNetwork/);
  assert.doesNotMatch(bundle, /analyzeTextAsync|proofreadTextWithHarper|LocalLinter|slimBinary|slimBinaryInlined|harper-js/);
  assert.ok(statSync(bundleUrl).size < 250_000, "WordPress browser bundle should avoid the bundled local grammar engine");
});

test("WordPress committed bundle matches the current source build", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "fpca-wp-bundle-"));
  try {
    const result = spawnSync(
      "pnpm",
      ["--filter", "@flavorpress/wordpress-plugin", "exec", "vite", "build", "--config", "vite.config.ts", "--outDir", tempDir],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const committed = readFileSync(new URL("../plugins/wordpress/assets/block.js", import.meta.url), "utf8");
    const rebuilt = readFileSync(join(tempDir, "block.js"), "utf8");
    assert.equal(committed, rebuilt);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("WordPress plugin PHP syntax is valid when PHP is available", () => {
  const phpFile = new URL("../plugins/wordpress/flavorpress-content-analyzer.php", import.meta.url);
  const result = spawnSync("php", ["-l", phpFile.pathname], { encoding: "utf8" });
  if (result.error?.code === "ENOENT") {
    return;
  }
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("WordPress storage records analyzer revision metadata without text defaults", () => {
  const php = readFileSync(new URL("../plugins/wordpress/flavorpress-content-analyzer.php", import.meta.url), "utf8");
  const blockSource = readFileSync(new URL("../plugins/wordpress/src/block.ts", import.meta.url), "utf8");

  assert.match(php, /FPCA_DB_VERSION/);
  assert.match(php, /analyzer_version varchar\(32\) DEFAULT NULL/);
  assert.match(php, /'analyzer_version' => FPCA_VERSION/);
  assert.match(blockSource, /analyzerVersion: config\.analyzerVersion/);
  assert.equal((php.match(/PRIMARY KEY\s+\(id\)/g) ?? []).length, 1);
  assert.doesNotMatch(php, /\b(?:long)?text DEFAULT NULL\b/i);
});

test("WordPress analysis controls pass local context into analyzer metadata", () => {
  const php = readFileSync(new URL("../plugins/wordpress/flavorpress-content-analyzer.php", import.meta.url), "utf8");
  const blockSource = readFileSync(new URL("../plugins/wordpress/src/block.ts", import.meta.url), "utf8");

  assert.match(php, /data-fpca-language/);
  assert.match(php, /data-fpca-genre/);
  assert.match(php, /data-fpca-goal/);
  assert.match(php, /data-fpca-sources/);
  assert.match(blockSource, /languageHint: context\.languageHint/);
  assert.match(blockSource, /genre: context\.genre/);
  assert.match(blockSource, /goal: context\.goal/);
  assert.match(blockSource, /sources: context\.sources/);
  assert.match(blockSource, /sourceLines\(sources/);
});

test("WordPress language defaults use auto-detect like desktop", () => {
  const php = readFileSync(new URL("../plugins/wordpress/flavorpress-content-analyzer.php", import.meta.url), "utf8");
  const blockSource = readFileSync(new URL("../plugins/wordpress/src/block.ts", import.meta.url), "utf8");

  assert.match(blockSource, /languageHint: "auto"/);
  assert.match(php, /<option value="auto" selected>/);
  assert.doesNotMatch(php, /<option value="en" selected>/);
});

test("WordPress sanitizer allows local-only provider metadata", () => {
  const php = readFileSync(new URL("../plugins/wordpress/flavorpress-content-analyzer.php", import.meta.url), "utf8");

  assert.match(php, /\['none', 'localhost_only', 'remote'\]/);
  assert.match(php, /fpca_sanitize_providers/);
  assert.match(php, /content_audit/);
});

test("WordPress sanitizer bands stay aligned with analyzer-core values", () => {
  const php = readFileSync(new URL("../plugins/wordpress/flavorpress-content-analyzer.php", import.meta.url), "utf8");

  for (const band of signalBands) {
    assert.match(php, new RegExp(`'${band}'`));
  }
  for (const band of qualityBands) {
    assert.match(php, new RegExp(`'${band}'`));
  }
  for (const band of sourceBands) {
    assert.match(php, new RegExp(`'${band}'`));
  }
});

test("WordPress package metadata and privacy copy stay local-first", () => {
  const php = readFileSync(new URL("../plugins/wordpress/flavorpress-content-analyzer.php", import.meta.url), "utf8");
  const readme = readFileSync(new URL("../plugins/wordpress/readme.txt", import.meta.url), "utf8");

  assert.match(php, /Update URI: false/);
  assert.match(readme, /Tested up to: 6\.9/);
  assert.match(readme, /posted back to the same WordPress site/);
  assert.match(readme, /not sent to a hosted third-party analysis service/);
  assert.match(readme, /salted hashes of the input, visitor IP plus user agent, and user agent/);
  assert.match(php, /salted hashes of the input, visitor IP plus user agent, and user agent/);
});

test("WordPress public endpoints avoid frontend report enumeration details", () => {
  const php = readFileSync(new URL("../plugins/wordpress/flavorpress-content-analyzer.php", import.meta.url), "utf8");

  const duplicateResponse = php.match(/\$duplicate_id[\s\S]*?rest_ensure_response\(\[[\s\S]*?\]\);/)?.[0] ?? "";
  const frontendInsertResponse = php.match(/if \(\$source_type === 'frontend'\) \{[\s\S]*?return rest_ensure_response\(\[[\s\S]*?\]\);[\s\S]*?\}/)?.[0] ?? "";

  assert.match(duplicateResponse, /'duplicate' => true/);
  assert.match(duplicateResponse, /'stored' => true/);
  assert.doesNotMatch(duplicateResponse, /adminUrl|'id' =>/);
  assert.match(frontendInsertResponse, /'stored' => true/);
  assert.doesNotMatch(frontendInsertResponse, /adminUrl|'id' =>/);
});

test("WordPress admin settings and public rate limiting use narrow permissions and locks", () => {
  const php = readFileSync(new URL("../plugins/wordpress/flavorpress-content-analyzer.php", import.meta.url), "utf8");

  assert.match(php, /function fpca_settings_permission\(\): bool/);
  assert.match(php, /return current_user_can\('manage_options'\);/);
  assert.match(php, /function fpca_acquire_rate_limit_lock/);
  assert.match(php, /add_option\(\$lock_key, \(string\) \$now, '', 'no'\)/);
  assert.match(php, /finally \{\s*fpca_release_rate_limit_lock\(\$lock_key\);/);
  assert.match(php, /if \(\$network_wide && is_multisite\(\)\)/);
});

test("WordPress no-raw storage path drops client free-text report details", () => {
  const php = readFileSync(new URL("../plugins/wordpress/flavorpress-content-analyzer.php", import.meta.url), "utf8");

  assert.match(php, /if \(!\$store_raw_text\)/);
  assert.match(php, /client-supplied free-text report details/);
  assert.match(php, /'dimensions' => \[\]/);
  assert.match(php, /'spans' => \[\]/);
  assert.match(php, /'claims' => \[\]/);
  assert.match(php, /'recommendations' => \[\]/);
});

test("WordPress public form discloses raw text storage state", () => {
  const php = readFileSync(new URL("../plugins/wordpress/flavorpress-content-analyzer.php", import.meta.url), "utf8");

  assert.match(php, /\$settings\['store_raw_text'\]/);
  assert.match(php, /store the full submitted text/);
  assert.match(php, /posted back to this same WordPress site/);
  assert.match(php, /discarded after hashing, duplicate checks, rate limiting, and report sanitization/);
});

test("WordPress editor preserves block structure before analysis", () => {
  const blockSource = readFileSync(new URL("../plugins/wordpress/src/block.ts", import.meta.url), "utf8");

  assert.match(blockSource, /function stripEditorMarkup/);
  assert.match(blockSource, /<li\[\^>\]\*>/);
  assert.match(blockSource, /"#"\.repeat/);
  assert.match(blockSource, /\\n\{3,\}/);
});

test("WordPress admin reports disclose browser-generated trust status", () => {
  const php = readFileSync(new URL("../plugins/wordpress/flavorpress-content-analyzer.php", import.meta.url), "utf8");

  assert.match(php, /browser-generated review snapshots/);
  assert.match(php, /trustNote/);
  assert.match(php, /not recomputed server-side/);
});
