import { deck, matchSources, slideById } from "@ava/shared";
import { z } from "zod";
import { initialNotes, prunePlan, type NotesState } from "../web/src/presentation/notes.js";
import { checkCase, type EvalCase } from "./checks.js";
import { judge, JUDGE_DIMENSIONS, type JudgeDeps } from "./judge.js";
import { RealtimeText } from "./realtimeText.js";
import type { MultiOutcome, TurnOutcomeRecord } from "./report.js";

const Turn = z.union([
  z.object({ ask: z.string() }).strict(),
  z.object({ interrupt: z.string() }).strict(),
  z.object({ navigate: z.string() }).strict(),
  z.object({ backchannel: z.string() }).strict(),
]);

export const Script = z.object({ id: z.string(), turns: z.array(Turn).min(2) }).strict();
export type Script = z.infer<typeof Script>;

/** Fails loudly when a script names a case or slide that does not exist. */
export function validateScript(s: Script, cases: Map<string, EvalCase>) {
  const slides = new Set(deck.map((d) => d.id as string));
  s.turns.forEach((t, i) => {
    if ("navigate" in t) {
      if (!slides.has(t.navigate))
        throw new Error(`${s.id} turn ${i + 1}: unknown slide ${t.navigate}`);
      return;
    }
    const id = "ask" in t ? t.ask : "interrupt" in t ? t.interrupt : t.backchannel;
    if (!cases.has(id)) throw new Error(`${s.id} turn ${i + 1}: unknown case ${id}`);
  });
}

/**
 * One scripted session: a single Realtime socket, the controller's pruning (arch §5.10) applied
 * with the same `prunePlan`, ask and backchannel turns scored with the golden-set checks and judge.
 */
export async function runScript(
  script: Script,
  cases: Map<string, EvalCase>,
  opts: { apiKey: string; model: string; judge: JudgeDeps },
): Promise<MultiOutcome> {
  const turns: TurnOutcomeRecord[] = [];
  let session: RealtimeText | null = null;
  const notes: NotesState = initialNotes();
  try {
    session = await RealtimeText.open(opts.apiKey, opts.model);
    session.setSlide("intro");

    for (const [index, t] of script.turns.entries()) {
      const base = { index, qaPairsKept: notes.qaPairs.length, totalTokens: null, failures: [] };
      if ("navigate" in t) {
        session.setSlide(t.navigate as never);
        session.addNote(`Presented slide ${t.navigate}, ${slideById(t.navigate as never).title}.`);
        turns.push({ ...base, kind: "navigate", scored: false, pass: true });
        continue;
      }
      if ("interrupt" in t) {
        const c = cases.get(t.interrupt)!;
        if (session.slide !== c.slide) session.setSlide(c.slide);
        await session.askAndCancel(c.question);
        turns.push({ ...base, kind: "interrupt", caseId: c.id, scored: false, pass: true });
        continue;
      }
      const kind = "ask" in t ? "ask" : "backchannel";
      const c = cases.get("ask" in t ? t.ask : t.backchannel)!;
      if (session.slide !== c.slide) session.setSlide(c.slide);
      const out = await session.ask(c.question);
      const failures = checkCase(c, out);
      if (kind === "ask") {
        const verdict = await judge(c, out, opts.judge);
        for (const d of JUDGE_DIMENSIONS) if (!verdict[d].pass) failures.push(`judge ${d}`);
        // Same bookkeeping as the controller's recordQaPair, then the same prune plan.
        notes.qaPairs.push({
          itemIds: out.itemIds,
          factIds: matchSources(out.text, deck).factIds,
        });
        const plan = prunePlan(notes);
        if (plan.delete.length) {
          session.deleteItems(plan.delete);
          notes.qaPairs = plan.keep;
          notes.pruneNoteId = plan.note ? session.addNote(plan.note) : null;
        }
      }
      turns.push({
        index,
        kind,
        caseId: c.id,
        scored: true,
        pass: failures.length === 0,
        failures,
        totalTokens: out.totalTokens,
        qaPairsKept: notes.qaPairs.length,
      });
    }
    return { id: script.id, turns };
  } catch (e) {
    return { id: script.id, turns, error: e instanceof Error ? e.message : String(e) };
  } finally {
    session?.close();
  }
}
