import { deck, type Slide } from "./deck.js";

/**
 * Names and labels that contain digits but aren't facts: GLP-1, STEP-1, type 2, MEN 2, phase 3…
 * They are removed before numbers are compared.
 */
const LABEL_NUMBERS = /\b[A-Za-z]+-\d+\b|\b(?:type|MEN|phase|stage)\s+\d+\b/gi;

export function numbersIn(text: string): string[] {
  const cleaned = text.replace(LABEL_NUMBERS, " ").replace(/(\d),(\d{3})/g, "$1$2");
  return [...new Set(cleaned.match(/\d+(?:\.\d+)?/g) ?? [])];
}

export interface SourceMatch {
  factIds: string[];
  /** Source labels of the matched facts, for the caption's "Source: …" line (arch §5.4). */
  sources: string[];
  /** Numbers in the answer that no reviewed fact contains (the "unsourced number" flag, §5.8). */
  unsourced: string[];
}

/** Matches numbers in an answer against deck facts; greedy cover, fewest facts first. */
export function matchSources(text: string, slides: Slide[]): SourceMatch {
  const wanted = numbersIn(text);
  if (wanted.length === 0) return { factIds: [], sources: [], unsourced: [] };
  const facts = slides.flatMap((slide) =>
    slide.facts.map((f) => ({ slide, fact: f, nums: new Set(numbersIn(f.text)) })),
  );
  const uncovered = new Set(wanted.filter((n) => facts.some((f) => f.nums.has(n))));
  const unsourced = wanted.filter((n) => !uncovered.has(n));
  const picked: typeof facts = [];
  while (uncovered.size > 0) {
    let best = facts[0]!;
    let bestCount = 0;
    for (const f of facts) {
      let c = 0;
      for (const n of uncovered) if (f.nums.has(n)) c++;
      if (c > bestCount) {
        best = f;
        bestCount = c;
      }
    }
    if (bestCount === 0) break;
    picked.push(best);
    for (const n of best.nums) uncovered.delete(n);
  }
  const sources = [
    ...new Set(
      picked.flatMap(({ slide, fact }) =>
        fact.sourceIds.map((id) => slide.sources.find((s) => s.id === id)?.label ?? id),
      ),
    ),
  ];
  return { factIds: picked.map((p) => p.fact.id), sources, unsourced };
}

/** Numbers in an answer that no reviewed fact contains, ignoring numbers the listener said. */
export function unsourcedNumbers(answer: string, question = ""): string[] {
  const asked = new Set(numbersIn(question));
  // "slide 4" is navigation, not a claim.
  const text = answer.replace(/\bslides?\s+\d+\b/gi, " ");
  return matchSources(text, deck).unsourced.filter((n) => !asked.has(n));
}

/** Personal dosing advice ("you should start 2.4 mg"), wrong for any answer (arch §5.8 check 3). */
export const DOSING_PATTERN =
  /\byou (?:should|could|can|need to) (?:start|take|begin|inject|increase|double)\b[^.?!]*\d+(?:\.\d+)?\s*mg\b/i;

export const sentenceCount = (t: string) =>
  t.split(/(?<=[.!?])\s+/).filter((s) => /\w/.test(s)).length;

export type QualityFlag = "unsourced_number" | "dosing_pattern" | "over_4_sentences";

/** Runtime guard flags for one final assistant transcript (arch §5.8). Only flag names leave. */
export function qualityFlags(transcript: string): QualityFlag[] {
  const text = transcript.replace(/[‘’]/g, "'");
  const flags: QualityFlag[] = [];
  if (unsourcedNumbers(text).length > 0) flags.push("unsourced_number");
  if (DOSING_PATTERN.test(text)) flags.push("dosing_pattern");
  if (sentenceCount(text) > 4) flags.push("over_4_sentences");
  return flags;
}
