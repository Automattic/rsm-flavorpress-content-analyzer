import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const binaryPath = resolve(
  root,
  "apps/desktop/src-tauri/target/release/flavorpress_content_analyzer_desktop",
);
const requiredCommands = ["desktop_extract_url", "desktop_copy_text"];

if (!existsSync(binaryPath)) {
  throw new Error(`Desktop binary is missing: ${binaryPath}`);
}

const binary = readFileSync(binaryPath);
for (const command of requiredCommands) {
  if (!binary.includes(Buffer.from(command))) {
    throw new Error(`Desktop binary does not contain required command: ${command}`);
  }
}

console.log("Desktop binary command guard passed.");
