// What `langsmith apps push` would upload from this directory, against its limits. Push reads
// no .gitignore, so this counts everything but the directories it skips.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SKIPPED = new Set(["node_modules", ".git"]);
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 500;
const ENTRYPOINT = "dist/bundle.js";

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else yield path;
  }
}

const all = [...files(ROOT)];
const bytes = all.reduce((sum, path) => sum + statSync(path).size, 0);
// Git's heuristic: a NUL byte in the first 8000 bytes makes a file binary.
const binary = all.filter((path) => readFileSync(path).subarray(0, 8000).includes(0));
const names = all.map((path) => relative(ROOT, path));

const problems = [];
if (!names.includes(ENTRYPOINT)) problems.push(`${ENTRYPOINT} is missing: build first`);
if (bytes > MAX_BYTES) problems.push(`${(bytes / 1024 / 1024).toFixed(2)} MiB is over 5 MiB`);
if (all.length > MAX_FILES) problems.push(`${all.length} files is over ${MAX_FILES}`);
for (const path of binary) problems.push(`binary file: ${relative(ROOT, path)}`);

console.log(`upload: ${all.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MiB`);
if (problems.length) {
  for (const problem of problems) console.error(`error: ${problem}`);
  process.exit(1);
}
