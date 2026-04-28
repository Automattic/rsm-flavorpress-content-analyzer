import { chmodSync } from "node:fs";
import { resolve } from "node:path";

const target = process.argv[2];
if (!target) {
  throw new Error("Usage: node scripts/make-executable.mjs <path>");
}

chmodSync(resolve(process.cwd(), target), 0o755);
