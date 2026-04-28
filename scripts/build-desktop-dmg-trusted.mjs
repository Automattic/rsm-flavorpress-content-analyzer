import { spawn } from "node:child_process";

const developerIdPrefix = "Developer ID Application:";
const signingApprovalVar = "FLAVORPRESS_APPROVE_DESKTOP_SIGNING";
const appleIdCredentialVars = ["APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"];
const appStoreConnectCredentialVars = ["APPLE_API_ISSUER", "APPLE_API_KEY", "APPLE_API_KEY_PATH"];

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const { printOutput = true, ...spawnOptions } = options;
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...spawnOptions,
    });
    let output = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      if (printOutput) {
        process.stdout.write(text);
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      if (printOutput) {
        process.stderr.write(text);
      }
    });
    child.on("error", rejectRun);
    child.on("close", (code) => resolveRun({ code: code ?? 1, output }));
  });
}

function missingEnv(vars) {
  return vars.filter((name) => !process.env[name]);
}

function parseDeveloperIdIdentity(output) {
  const lines = output.split(/\r?\n/).map((line) => line.trim());
  const explicitIdentity = process.env.APPLE_SIGNING_IDENTITY;

  if (explicitIdentity) {
    const matchingLine = lines.find((line) => line.includes(`"${explicitIdentity}"`));
    if (!explicitIdentity.startsWith(developerIdPrefix)) {
      throw new Error(
        `APPLE_SIGNING_IDENTITY must be a "${developerIdPrefix}" certificate for external macOS distribution.`,
      );
    }
    if (!matchingLine) {
      throw new Error(`APPLE_SIGNING_IDENTITY was set, but this keychain does not list "${explicitIdentity}".`);
    }
    return explicitIdentity;
  }

  const developerIdLine = lines.find((line) => line.includes(`"${developerIdPrefix}`));
  if (!developerIdLine) {
    throw new Error(
      `No "${developerIdPrefix}" code-signing identity was found. Install a Developer ID Application certificate or set APPLE_SIGNING_IDENTITY to one available in the keychain.`,
    );
  }

  const match = developerIdLine.match(/"([^"]+)"/);
  if (!match) {
    throw new Error("Found a Developer ID Application identity, but could not parse its keychain name.");
  }
  return match[1];
}

async function requireDeveloperIdIdentity() {
  const result = await run("security", ["find-identity", "-v", "-p", "codesigning"], { printOutput: false });
  if (result.code !== 0) {
    throw new Error("Unable to list macOS code-signing identities.");
  }
  return parseDeveloperIdIdentity(result.output);
}

function requireNotarizationCredentials() {
  const missingAppleId = missingEnv(appleIdCredentialVars);
  const missingAppStoreConnect = missingEnv(appStoreConnectCredentialVars);

  if (missingAppleId.length === 0 || missingAppStoreConnect.length === 0) {
    return;
  }

  throw new Error(
    `Notarization credentials are missing. Provide either ${appStoreConnectCredentialVars.join(", ")} or ${appleIdCredentialVars.join(", ")}.`,
  );
}

async function main() {
  if (process.env[signingApprovalVar] !== "1") {
    throw new Error(
      `Trusted desktop signing/notarization requires explicit approval. Set ${signingApprovalVar}=1 only after a maintainer approves signing and notarizing this desktop artifact.`,
    );
  }

  const signingIdentity = await requireDeveloperIdIdentity();
  requireNotarizationCredentials();

  const build = await run("node", ["scripts/build-desktop-dmg.mjs"], {
    env: {
      ...process.env,
      APPLE_SIGNING_IDENTITY: signingIdentity,
    },
  });
  if (build.code !== 0) {
    process.exit(build.code);
  }

  const trust = await run("pnpm", ["desktop:verify-dmg:trusted"]);
  process.exit(trust.code);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
