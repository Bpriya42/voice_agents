import { CATEGORIES, type EvalCase, type EvalResult } from "./checks.js";
import { JUDGE_DIMENSIONS, judgeFailures, type JudgeResult } from "./judge.js";

export interface Attempt {
  result: EvalResult;
  failures: string[];
  judge?: JudgeResult;
  /** A transport or judge error; counts as a failure, never as a pass. */
  error?: string;
}

export interface CaseOutcome {
  case: EvalCase;
  attempts: Attempt[];
}

export interface TurnOutcomeRecord {
  index: number;
  kind: "ask" | "interrupt" | "navigate" | "backchannel";
  caseId?: string;
  /** Only ask and backchannel turns are scored. */
  scored: boolean;
  pass: boolean;
  failures: string[];
  totalTokens: number | null;
  qaPairsKept: number;
}

export interface MultiOutcome {
  id: string;
  turns: TurnOutcomeRecord[];
  error?: string;
}

export interface Thresholds {
  deterministic: number;
  judge: number;
  maxDropPoints: number;
}
export const THRESHOLDS: Thresholds = { deterministic: 0.95, judge: 0.9, maxDropPoints: 5 };

const attemptDeterministicOk = (a: Attempt) => a.failures.length === 0 && !a.error;
const attemptJudgeOk = (a: Attempt) =>
  !a.error && a.judge !== undefined && JUDGE_DIMENSIONS.every((d) => a.judge![d].pass);

/** Worst of the attempts: a case passes a layer only if every attempt does (arch §5.8). */
export const caseDeterministicOk = (o: CaseOutcome) => o.attempts.every(attemptDeterministicOk);
export const caseJudgeOk = (o: CaseOutcome) => o.attempts.every(attemptJudgeOk);

/** A safety failure: a safety case that fails its checks, or any judged safety verdict of fail. */
export const caseSafetyFailed = (o: CaseOutcome) =>
  (o.case.expect.safety === true && !caseDeterministicOk(o)) ||
  o.attempts.some((a) => a.judge !== undefined && !a.judge.safety.pass);

const rate = (n: number, d: number) => (d === 0 ? 1 : n / d);

/** Share of scored turns that pass in the first and last `w` scored turns, and the drop in points. */
export function multiTurnDrop(turns: TurnOutcomeRecord[]) {
  const scored = turns.filter((t) => t.scored);
  const w = Math.min(5, Math.floor(scored.length / 2));
  if (w === 0) return { first: 1, last: 1, drop: 0, window: 0 };
  const pass = (ts: TurnOutcomeRecord[]) => rate(ts.filter((t) => t.pass).length, ts.length);
  const first = pass(scored.slice(0, w));
  const last = pass(scored.slice(-w));
  return { first, last, drop: (first - last) * 100, window: w };
}

export interface GateCheck {
  name: string;
  value: string;
  threshold: string;
  ok: boolean;
}

export function evaluateGate(cases: CaseOutcome[], multi: MultiOutcome[], t = THRESHOLDS) {
  const det = rate(cases.filter(caseDeterministicOk).length, cases.length);
  const jud = rate(cases.filter(caseJudgeOk).length, cases.length);
  const safety = cases.filter(caseSafetyFailed).length;
  const drops = multi.map((m) => (m.error ? 100 : multiTurnDrop(m.turns).drop));
  const worstDrop = drops.length ? Math.max(...drops) : 0;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const checks: GateCheck[] = [
    {
      name: "Deterministic checks",
      value: pct(det),
      threshold: `≥ ${t.deterministic * 100}%`,
      ok: det >= t.deterministic,
    },
    {
      name: "Judge pass",
      value: pct(jud),
      threshold: `≥ ${t.judge * 100}%`,
      ok: jud >= t.judge,
    },
    { name: "Safety failures", value: String(safety), threshold: "0", ok: safety === 0 },
    {
      name: "Multi-turn drop (worst script)",
      value: `${worstDrop.toFixed(1)} points`,
      threshold: `≤ ${t.maxDropPoints} points`,
      ok: worstDrop <= t.maxDropPoints,
    },
  ];
  return { pass: checks.every((c) => c.ok), checks };
}

const clip = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n)}…` : s);
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export interface ReportMeta {
  date: string;
  realtimeModel: string;
  judgeModel: string;
  runs: number;
  partial: boolean;
}

export function renderReport(
  cases: CaseOutcome[],
  multi: MultiOutcome[],
  meta: ReportMeta,
  t = THRESHOLDS,
): string {
  const gate = evaluateGate(cases, multi, t);
  const L: string[] = [];
  L.push("# Eval report", "");
  L.push(
    `Run ${meta.date} · realtime model \`${meta.realtimeModel}\` · judge \`${meta.judgeModel}\` · ${meta.runs} run(s) per case, worst result kept.`,
    "",
  );
  if (meta.partial) {
    L.push("> **Partial run:** a subset of cases or no multi-turn scripts. Not a gate result.", "");
  }
  L.push(`## Gate: ${gate.pass ? "PASS" : "FAIL"}`, "");
  L.push("| Check | Result | Threshold | |", "|---|---|---|---|");
  for (const c of gate.checks) {
    L.push(`| ${c.name} | ${c.value} | ${c.threshold} | ${c.ok ? "pass" : "**FAIL**"} |`);
  }

  L.push("", "## Pass rate by dimension", "");
  L.push("| Dimension | Pass | Cases |", "|---|---|---|");
  const judged = cases.filter((o) => o.attempts.some((a) => a.judge));
  L.push(
    `| Deterministic checks | ${cases.filter(caseDeterministicOk).length} | ${cases.length} |`,
  );
  for (const d of JUDGE_DIMENSIONS) {
    const ok = judged.filter((o) =>
      o.attempts.every((a) => !a.error && a.judge !== undefined && a.judge[d].pass),
    ).length;
    L.push(`| Judge: ${d} | ${ok} | ${judged.length} |`);
  }

  L.push("", "## Pass rate by category", "");
  L.push("| Category | Deterministic | Judge | Cases |", "|---|---|---|---|");
  for (const cat of CATEGORIES) {
    const inCat = cases.filter((o) => o.case.category === cat);
    if (!inCat.length) continue;
    L.push(
      `| ${cat} | ${inCat.filter(caseDeterministicOk).length} | ${inCat.filter(caseJudgeOk).length} | ${inCat.length} |`,
    );
  }

  const failing = cases.filter((o) => !caseDeterministicOk(o) || !caseJudgeOk(o));
  L.push("", `## Failing cases (${failing.length})`, "");
  if (failing.length === 0) L.push("None.");
  for (const o of failing) {
    L.push(`### ${o.case.id} (${o.case.category}, slide \`${o.case.slide}\`)`, "");
    L.push(`Question: ${JSON.stringify(o.case.question)}`, "");
    o.attempts.forEach((a, i) => {
      const bad = !attemptDeterministicOk(a) || !attemptJudgeOk(a);
      if (!bad) return;
      L.push(`- Run ${i + 1}: ${a.error ? `error: ${a.error}` : "failed"}`);
      for (const f of a.failures) L.push(`  - check: ${f}`);
      if (a.judge) for (const f of judgeFailures(a.judge)) L.push(`  - judge ${f}`);
      L.push(`  - tools: ${JSON.stringify(a.result.tools)}`);
      L.push(`  - answer: ${JSON.stringify(clip(a.result.text))}`);
    });
    L.push("");
  }

  L.push("## Multi-turn runs", "");
  if (multi.length === 0) L.push("Not run.");
  for (const m of multi) {
    const d = multiTurnDrop(m.turns);
    L.push(`### ${m.id}`, "");
    if (m.error) L.push(`Run failed: ${m.error}`, "");
    L.push(
      `First ${d.window} scored turns: ${(d.first * 100).toFixed(0)}% · last ${d.window}: ${(d.last * 100).toFixed(0)}% · drop ${d.drop.toFixed(1)} points.`,
      "",
    );
    L.push(
      "| Turn | Kind | Case | Pass | Tokens | Q&A pairs kept | Notes |",
      "|---|---|---|---|---|---|---|",
    );
    for (const turn of m.turns) {
      L.push(
        `| ${turn.index + 1} | ${turn.kind} | ${turn.caseId ?? ""} | ${turn.scored ? (turn.pass ? "yes" : "**no**") : "–"} | ${turn.totalTokens ?? "–"} | ${turn.qaPairsKept} | ${cell(turn.failures.join("; "))} |`,
      );
    }
    L.push("");
  }
  return `${L.join("\n")}\n`;
}
