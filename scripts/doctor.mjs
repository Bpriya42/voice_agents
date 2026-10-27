import { existsSync, readFileSync } from "node:fs";

const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => {
  console.log(`  FAIL ${m}`);
  process.exitCode = 1;
};

const major = Number(process.versions.node.split(".")[0]);
if (major === 24) ok(`Node ${process.versions.node}`);
else bad(`Node 24 required, found ${process.versions.node}`);

if (!existsSync(".env")) {
  bad(".env not found. Copy .env.example to .env and add your key.");
} else {
  // Reports presence and length only. The value is never printed.
  const line = readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith("OPENAI_API_KEY="));
  const value = line?.slice("OPENAI_API_KEY=".length).trim() ?? "";
  if (!value || value === "replace-with-your-key") bad("OPENAI_API_KEY is not set in .env");
  else ok(`OPENAI_API_KEY is set (${value.length} characters, value hidden)`);
}
