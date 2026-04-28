import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const ignored = new Set([
  ".git",
  "node_modules",
  "dist",
  "target",
  "coverage",
  ".turbo",
  ".next",
]);

const ignoredFiles = new Set([
  "plugins/wordpress/assets/block.js",
]);

const blocked = [
  [97, 97, 97, 99, 99, 101, 108, 101, 114, 97, 116, 101],
  [97, 112, 112, 45, 98, 97, 115, 101],
  [119, 97, 122],
  [119, 101, 98, 115, 105, 116, 101, 45, 97, 110, 97, 108, 121, 122, 101, 114],
  [109, 97, 116, 116, 104, 105, 97, 115, 114, 101, 105, 110, 104, 111, 108, 122],
].map((codes) => String.fromCharCode(...codes));

const binaryExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".icns",
  ".ico",
  ".zip",
  ".sqlite",
  ".wasm",
]);

function extension(path) {
  const index = path.lastIndexOf(".");
  return index >= 0 ? path.slice(index).toLowerCase() : "";
}

function walk(directory, files = []) {
  for (const entry of readdirSync(directory)) {
    if (ignored.has(entry)) {
      continue;
    }
    const fullPath = join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      walk(fullPath, files);
    } else if (!binaryExtensions.has(extension(fullPath))) {
      files.push(fullPath);
    }
  }
  return files;
}

const findings = [];
for (const file of walk(root)) {
  if (ignoredFiles.has(relative(root, file))) {
    continue;
  }
  const text = readFileSync(file, "utf8");
  const lower = text.toLowerCase();
  for (const token of blocked) {
    if (lower.includes(token.toLowerCase())) {
      findings.push(`${relative(root, file)} contains a blocked legacy identifier.`);
      break;
    }
  }
}

if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exit(1);
}

console.log("Name boundary scan passed.");
