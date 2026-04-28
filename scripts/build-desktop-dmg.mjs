import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauriConfig = JSON.parse(readFileSync(resolve(root, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"));
const dmgDir = resolve(root, "apps/desktop/src-tauri/target/release/bundle/dmg");
const dmgNamePattern = new RegExp(
  `^${escapeRegex(tauriConfig.productName)}_${escapeRegex(tauriConfig.version)}_.+\\.dmg$`,
);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function modifiedAt(path) {
  return existsSync(path) ? statSync(path).mtimeMs : 0;
}

function latestDmgModifiedAt() {
  if (!existsSync(dmgDir)) {
    return 0;
  }

  return readdirSync(dmgDir)
    .filter((entry) => dmgNamePattern.test(entry))
    .map((entry) => modifiedAt(resolve(dmgDir, entry)))
    .reduce((latest, timestamp) => Math.max(latest, timestamp), 0);
}

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });
    child.on("error", rejectRun);
    child.on("close", (code) => resolveRun({ code: code ?? 1, output }));
  });
}

async function verifyDmg() {
  const result = await run("node", ["scripts/check-desktop-dmg.mjs"]);
  if (result.code !== 0) {
    throw new Error("DMG verification failed");
  }
}

async function main() {
  const coreBuild = await run("pnpm", ["--filter", "@flavorpress/analyzer-core", "build"]);
  if (coreBuild.code !== 0) {
    process.exit(coreBuild.code);
  }

  const beforeBuild = latestDmgModifiedAt();
  const tauriBuild = await run("pnpm", ["--dir", "apps/desktop", "exec", "tauri", "build", "--bundles", "dmg"]);
  if (tauriBuild.code !== 0) {
    const knownCleanupIssue =
      tauriBuild.output.includes("Failed to clean the app bundle") &&
      tauriBuild.output.includes("No such file or directory") &&
      latestDmgModifiedAt() > beforeBuild;

    if (!knownCleanupIssue) {
      process.exit(tauriBuild.code);
    }

    console.warn("Tauri produced the DMG but returned a post-build cleanup error; verifying the generated image.");
    await verifyDmg();
  } else {
    await verifyDmg();
  }

  const binaryGuard = await run("node", ["scripts/check-desktop-binary.mjs"]);
  process.exit(binaryGuard.code);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
