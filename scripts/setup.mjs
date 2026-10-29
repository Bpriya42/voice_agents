// One-time local setup after cloning: npm run setup (or node scripts/setup.mjs).
// Uses only Node built-ins, so it runs before dependencies are installed.
// It never reads or prints .env; it only creates it from .env.example when missing.
import { execSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";

const step = (m) => console.log(`\n> ${m}`);
const fail = (m) => {
  console.error(`\n  FAIL ${m}`);
  process.exit(1);
};
const run = (command) => {
  try {
    // Fixed commands only. A shell is needed for the npm and npx .cmd shims on Windows.
    execSync(command, { stdio: "inherit" });
  } catch {
    fail(`${command} failed`);
  }
};

step("Checking Node version");
const major = Number(process.versions.node.split(".")[0]);
if (major !== 24) {
  fail(
    `Node 24 required, found ${process.versions.node}. With fnm: fnm install 24 && fnm use 24 (it reads .nvmrc).`,
  );
}
console.log(`  ok   Node ${process.versions.node}`);

step("Installing dependencies");
run("npm install");

if (process.argv.includes("--e2e")) {
  step("Installing Playwright Chromium for npm run e2e");
  run("npx playwright install chromium");
}

step("Creating .env");
if (existsSync(".env")) {
  console.log("  ok   .env already exists, left unchanged");
} else {
  copyFileSync(".env.example", ".env");
  console.log("  ok   .env created from .env.example");
}

step("Checking configuration");
// Same Node as this script, so the version check matches.
const doctor = spawnSync(process.execPath, ["scripts/doctor.mjs"], { stdio: "inherit" });

if (doctor.status === 0) {
  console.log("\nSetup complete. Start the app with npm run dev, then open http://localhost:5173");
} else {
  console.log(
    "\nAlmost done: open .env in your editor and replace replace-with-your-key with your OpenAI API key.\nThen run npm run doctor to check it, and npm run dev to start.",
  );
}
