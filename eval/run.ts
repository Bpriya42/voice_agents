// Answer-quality eval (arch §5.8, §5.10). Calls the real OpenAI API and costs money: run it only
// when you mean to. `npm run eval -- --validate` loads and checks the files with no network.
//
//   npm run eval                      full run: golden set x3, three multi-turn scripts, gate
//   npm run eval -- --only cross-side-effects --runs 1 --no-multiturn
//
// The key is read from process.env (npm run eval loads .env through node's --env-file-if-exists)
// and is only ever sent in an Authorization header. Nothing here prints it.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCase } from "./checks.js";
import { judge } from "./judge.js";
import { loadCases, loadScripts } from "./load.js";
import { runScript } from "./multiturn.js";
import { askOnce } from "./realtimeText.js";
import {
  evaluateGate,
  renderReport,
  type Attempt,
  type CaseOutcome,
  type MultiOutcome,
} from "./report.js";

const here = dirname(fileURLToPath(import.meta.url));
const CONCURRENCY = 3;

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : (process.argv[i + 1] ?? "");
}
const has = (name: string) => process.argv.includes(`--${name}`);

/** Runs `fn` over `items` with at most `n` in flight, keeping input order. */
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

async function main() {
  const cases = loadCases();
  const scripts = loadScripts(cases);
  if (has("validate")) {
    console.log(
      `ok: ${cases.length} cases, ${scripts.length} multi-turn scripts (${scripts.map((s) => s.turns.length).join(", ")} turns)`,
    );
    return;
  }

  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    console.error("OPENAI_API_KEY is not set. Put it in .env yourself; see .env.example.");
    process.exit(2);
  }
  const model = process.env["OPENAI_REALTIME_MODEL"] || "gpt-realtime";
  const judgeModel = process.env["EVAL_JUDGE_MODEL"] || "gpt-4.1";
  const judgeDeps = { apiKey, model: judgeModel };
  const runs = Number(flag("runs") ?? 3) || 3;
  const only = flag("only");
  const selected = only ? cases.filter((c) => only.split(",").includes(c.id)) : cases;
  if (selected.length === 0) throw new Error(`no case matches --only ${only}`);
  const partial = selected.length !== cases.length || has("no-multiturn");

  console.log(`golden set: ${selected.length} cases x ${runs} runs (concurrency ${CONCURRENCY})`);
  const work = selected.flatMap((c) => Array.from({ length: runs }, () => c));
  const attempts = await pool(work, CONCURRENCY, async (c): Promise<[string, Attempt]> => {
    try {
      const result = await askOnce(c.question, c.slide, apiKey, model);
      const failures = checkCase(c, result);
      const verdict = await judge(c, result, judgeDeps);
      return [c.id, { result, failures, judge: verdict }];
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      return [c.id, { result: { text: "", tools: [] }, failures: [], error }];
    }
  });
  const outcomes: CaseOutcome[] = selected.map((c) => ({
    case: c,
    attempts: attempts.filter(([id]) => id === c.id).map(([, a]) => a),
  }));

  let multi: MultiOutcome[] = [];
  if (!has("no-multiturn")) {
    const byId = new Map(cases.map((c) => [c.id, c]));
    console.log(`multi-turn: ${scripts.map((s) => s.id).join(", ")}`);
    multi = await pool(scripts, CONCURRENCY, (s) =>
      runScript(s, byId, { apiKey, model, judge: judgeDeps }),
    );
  }

  const meta = {
    date: new Date().toISOString().slice(0, 10),
    realtimeModel: model,
    judgeModel,
    runs,
    partial,
  };
  const md = renderReport(outcomes, multi, meta);
  const target = partial ? join(here, ".cache", "report.partial.md") : join(here, "report.md");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, md);

  const gate = evaluateGate(outcomes, multi);
  for (const c of gate.checks) {
    console.log(`${c.ok ? "pass" : "FAIL"}  ${c.name}: ${c.value} (${c.threshold})`);
  }
  console.log(`report: ${target}`);
  if (partial) console.log("partial run: not a gate result");
  process.exit(gate.pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(2);
});
