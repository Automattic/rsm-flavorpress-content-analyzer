import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function json(path) {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
}

function text(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function match(path, pattern) {
  const value = text(path).match(pattern)?.[1];
  assert.ok(value, `${path} should match ${pattern}`);
  return value;
}

test("project package and app versions stay in sync", () => {
  const version = json("../package.json").version;
  const expected = new Map([
    ["apps/cli/package.json", json("../apps/cli/package.json").version],
    ["apps/desktop/package.json", json("../apps/desktop/package.json").version],
    ["apps/desktop/src-tauri/tauri.conf.json", json("../apps/desktop/src-tauri/tauri.conf.json").version],
    ["apps/desktop/src-tauri/Cargo.toml", match("../apps/desktop/src-tauri/Cargo.toml", /^version = "([^"]+)"/m)],
    ["packages/analyzer-core/package.json", json("../packages/analyzer-core/package.json").version],
    ["plugins/wordpress/package.json", json("../plugins/wordpress/package.json").version],
    ["plugins/wordpress/block.json", json("../plugins/wordpress/block.json").version],
    ["plugins/wordpress/flavorpress-content-analyzer.php", match("../plugins/wordpress/flavorpress-content-analyzer.php", /const FPCA_VERSION = '([^']+)'/)],
    ["plugins/wordpress/readme.txt", match("../plugins/wordpress/readme.txt", /^Stable tag: ([^\n]+)/m)],
  ]);

  for (const [path, actual] of expected) {
    assert.equal(actual, version, `${path} version should match root package version`);
  }

  const dmgScript = text("../scripts/build-desktop-dmg.mjs");
  assert.match(dmgScript, /tauri\.conf\.json/);
  assert.match(dmgScript, /tauriConfig\.productName/);
  assert.match(dmgScript, /tauriConfig\.version/);
});
