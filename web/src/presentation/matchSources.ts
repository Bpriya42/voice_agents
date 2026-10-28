import type { Slide } from "@ava/shared";

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
export function matchSources(text: string, deck: Slide[]): SourceMatch {
  const wanted = numbersIn(text);
  if (wanted.length === 0) return { factIds: [], sources: [], unsourced: [] };
  const facts = deck.flatMap((slide) =>
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
