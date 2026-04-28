import { spawn } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauriConfigPath = resolve(root, "apps/desktop/src-tauri/tauri.conf.json");
const dmgDir = resolve(root, "apps/desktop/src-tauri/target/release/bundle/dmg");
const requireTrusted = process.argv.includes("--require-trusted");

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", rejectRun);
    child.on("close", (code) => resolveRun({ code: code ?? 1, output }));
  });
}

function firstOutputLine(result) {
  const lines = result.output
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("Processing:"));

  return lines.slice(0, 2).join("; ") || `exit ${result.code}`;
}

function parseArchitectures(lipoOutput) {
  const universal = lipoOutput.match(/are:\s*(.+)$/m);
  if (universal) {
    return universal[1].trim().split(/\s+/);
  }

  const thin = lipoOutput.match(/architecture:\s*(\S+)/m);
  return thin ? [thin[1]] : [];
}

async function readPlistValue(plistPath, key) {
  const result = await run("plutil", ["-extract", key, "raw", "-o", "-", plistPath]);
  if (result.code !== 0) {
    throw new Error(`Unable to read ${key} from ${plistPath}: ${firstOutputLine(result)}`);
  }
  return result.output.trim();
}

async function assertCommand(command, args, label) {
  const result = await run(command, args);
  if (result.code !== 0) {
    throw new Error(`${label} failed: ${firstOutputLine(result)}`);
  }
  return result;
}

async function inspectTrust(dmgPath, appPath) {
  const details = {
    appSignature: await run("codesign", ["-dv", "--verbose=4", appPath]),
    appStrict: await run("codesign", ["--verify", "--deep", "--strict", "--verbose=4", appPath]),
    appAssessment: await run("spctl", ["-a", "-vv", "--type", "execute", appPath]),
    dmgSignature: await run("codesign", ["-dv", "--verbose=4", dmgPath]),
    dmgAssessment: await run("spctl", [
      "-a",
      "-vv",
      "--type",
      "open",
      "--context",
      "context:primary-signature",
      dmgPath,
    ]),
    dmgStaple: await run("xcrun", ["stapler", "validate", dmgPath]),
  };

  const failures = [];
  if (details.appStrict.code !== 0) {
    failures.push(`app strict codesign: ${firstOutputLine(details.appStrict)}`);
  }
  if (details.appAssessment.code !== 0) {
    failures.push(`app Gatekeeper assessment: ${firstOutputLine(details.appAssessment)}`);
  }
  if (details.dmgAssessment.code !== 0) {
    failures.push(`DMG Gatekeeper assessment: ${firstOutputLine(details.dmgAssessment)}`);
  }
  if (details.dmgStaple.code !== 0) {
    failures.push(`DMG notarization ticket: ${firstOutputLine(details.dmgStaple)}`);
  }

  return { details, failures };
}

async function verifyDmg(dmgPath, tauriConfig) {
  const productName = tauriConfig.productName;
  const expectedVersion = tauriConfig.version;
  const expectedMinimumSystemVersion = tauriConfig.bundle?.macOS?.minimumSystemVersion;
  const mountDir = mkdtempSync(resolve(tmpdir(), "flavorpress-dmg."));
  let attached = false;

  console.log(`Checking ${basename(dmgPath)}`);
  await assertCommand("hdiutil", ["verify", dmgPath], "DMG checksum verification");

  try {
    await assertCommand("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mountDir, dmgPath], "DMG attach");
    attached = true;

    const appPath = resolve(mountDir, `${productName}.app`);
    if (!existsSync(appPath)) {
      throw new Error(`Expected app bundle is missing from DMG: ${productName}.app`);
    }

    const applicationsPath = resolve(mountDir, "Applications");
    if (!existsSync(applicationsPath) || !lstatSync(applicationsPath).isSymbolicLink()) {
      throw new Error("DMG is missing the Applications symlink");
    }
    const applicationsTarget = readlinkSync(applicationsPath);
    if (applicationsTarget !== "/Applications") {
      throw new Error(`Applications symlink points to ${applicationsTarget}, expected /Applications`);
    }

    const plistPath = resolve(appPath, "Contents/Info.plist");
    const appVersion = await readPlistValue(plistPath, "CFBundleShortVersionString");
    if (appVersion !== expectedVersion) {
      throw new Error(`App version ${appVersion} does not match tauri.conf.json version ${expectedVersion}`);
    }
    const appMinimumSystemVersion = await readPlistValue(plistPath, "LSMinimumSystemVersion");
    if (expectedMinimumSystemVersion && appMinimumSystemVersion !== expectedMinimumSystemVersion) {
      throw new Error(
        `App minimum macOS ${appMinimumSystemVersion} does not match tauri.conf.json minimum ${expectedMinimumSystemVersion}`,
      );
    }

    const executableName = await readPlistValue(plistPath, "CFBundleExecutable");
    const binaryPath = resolve(appPath, "Contents/MacOS", executableName);
    if (!existsSync(binaryPath)) {
      throw new Error(`App executable is missing: ${binaryPath}`);
    }

    const lipoResult = await assertCommand("lipo", ["-info", binaryPath], "Architecture inspection");
    const architectures = parseArchitectures(lipoResult.output);
    if (architectures.length === 0) {
      throw new Error(`Unable to determine binary architecture from lipo output: ${lipoResult.output.trim()}`);
    }

    const buildVersion = await run("vtool", ["-show-build", binaryPath]);
    const minVersion = buildVersion.output.match(/minos\s+([^\s]+)/)?.[1] ?? "unknown";
    if (expectedMinimumSystemVersion && minVersion !== "unknown" && minVersion !== expectedMinimumSystemVersion) {
      throw new Error(
        `Mach-O minimum macOS ${minVersion} does not match tauri.conf.json minimum ${expectedMinimumSystemVersion}`,
      );
    }
    const trust = await inspectTrust(dmgPath, appPath);

    console.log(`  Payload: ${productName}.app ${appVersion}`);
    console.log(`  Architectures: ${architectures.join(", ")}`);
    console.log(`  Minimum macOS: ${appMinimumSystemVersion} (Mach-O ${minVersion})`);

    if (trust.failures.length === 0) {
      console.log("  Distribution trust: accepted by local signing, Gatekeeper, and stapler checks");
    } else {
      console.log("  Distribution trust: not ready");
      for (const failure of trust.failures) {
        console.log(`    - ${failure}`);
      }
      if (requireTrusted) {
        throw new Error("DMG failed trusted-distribution checks");
      }
    }
  } finally {
    if (attached) {
      const detach = await run("hdiutil", ["detach", mountDir]);
      if (detach.code !== 0) {
        console.warn(`Warning: failed to detach ${mountDir}: ${firstOutputLine(detach)}`);
      }
    }
    rmSync(mountDir, { recursive: true, force: true });
  }
}

async function main() {
  if (!existsSync(tauriConfigPath)) {
    throw new Error(`Tauri config is missing: ${tauriConfigPath}`);
  }

  const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
  const dmgPattern = new RegExp(`^${escapeRegex(tauriConfig.productName)}_${escapeRegex(tauriConfig.version)}_.+\\.dmg$`);

  if (!existsSync(dmgDir)) {
    throw new Error(`DMG output directory is missing: ${dmgDir}`);
  }

  const dmgPaths = readdirSync(dmgDir)
    .filter((entry) => dmgPattern.test(entry))
    .sort()
    .map((entry) => resolve(dmgDir, entry));

  if (dmgPaths.length === 0) {
    throw new Error(`No DMG files matching ${dmgPattern} found in ${dmgDir}`);
  }

  for (const dmgPath of dmgPaths) {
    await verifyDmg(dmgPath, tauriConfig);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
