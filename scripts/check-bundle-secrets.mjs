import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const DIST = "web/dist";
const PATTERNS = [
  /sk-[A-Za-z0-9_-]{16,}/,
  /\bek_[A-Za-z0-9_-]{16,}/,
  /OPENAI_API_KEY/,
  /TURNSTILE_SECRET_KEY/,
  /STATS_TOKEN/,
  // The fake voice adapter is e2e-only and must be tree-shaken out of production builds.
  /ava-fake-voice-session/,
];

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(p);
    else yield p;
  }
}

let failed = false;
for await (const file of files(DIST)) {
  const text = await readFile(file, "utf8");
  for (const re of PATTERNS) {
    if (re.test(text)) {
      console.error(`Forbidden value matching ${re} found in ${file}`); // the value itself is never printed
      failed = true;
    }
  }
}
if (failed) process.exit(1);
console.log("Bundle secret check passed.");
