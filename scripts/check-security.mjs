import { spawnSync } from "node:child_process";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "inherit",
    ...options,
  });
  if (result.error?.code === "ENOENT") {
    return "missing";
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  return "ok";
}

run("pnpm", ["audit", "--audit-level", "moderate"]);

const cargoAudit = spawnSync("cargo", ["audit", "--version"], {
  encoding: "utf8",
  stdio: "ignore",
});

if (cargoAudit.error?.code === "ENOENT" || cargoAudit.status !== 0) {
  process.stdout.write("cargo-audit is not installed; skipped Rust advisory audit.\n");
} else {
  run("cargo", ["audit"], { cwd: "apps/desktop/src-tauri" });
}
