import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";
import { EvalCase } from "./checks.js";
import { Script, validateScript } from "./multiturn.js";

const here = dirname(fileURLToPath(import.meta.url));

export function loadCases(): EvalCase[] {
  const raw = parse(readFileSync(join(here, "cases.yaml"), "utf8"));
  const cases = z.array(EvalCase).parse(raw);
  const ids = new Set<string>();
  for (const c of cases) {
    if (ids.has(c.id)) throw new Error(`duplicate case id ${c.id}`);
    ids.add(c.id);
    for (const re of [...(c.expect.mustMatch ?? []), ...(c.expect.mustNotMatch ?? [])]) {
      new RegExp(re, "i"); // throws on a bad pattern
    }
  }
  return cases;
}

export function loadScripts(cases: EvalCase[]): Script[] {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const dir = join(here, "multiturn");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort((a, b) => parseInt(a) - parseInt(b))
    .map((f) => {
      const s = Script.parse(parse(readFileSync(join(dir, f), "utf8")));
      validateScript(s, byId);
      return s;
    });
}
