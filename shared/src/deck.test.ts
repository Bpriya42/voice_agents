import { describe, expect, it } from "vitest";
import { deck, SLIDE_IDS } from "./deck.js";

const numbers = (s: string) => s.match(/\d+(?:\.\d+)?/g) ?? [];
const slides = deck.map((s) => [s.id, s] as const);

describe("deck integrity", () => {
  it("has exactly the six slides in order", () => {
    expect(deck.map((s) => s.id)).toEqual([...SLIDE_IDS]);
  });

  it.each(slides)("%s: every fact cites an existing source", (_, slide) => {
    const ids = new Set(slide.sources.map((s) => s.id));
    for (const f of slide.facts) {
      expect(f.sourceIds.length, `${f.id} has no source`).toBeGreaterThan(0);
      for (const sid of f.sourceIds) expect(ids.has(sid), `${f.id} -> ${sid}`).toBe(true);
    }
  });

  it.each(slides)(
    "%s: every number on the slide or in the script appears in a fact",
    (_, slide) => {
      const factNumbers = new Set(slide.facts.flatMap((f) => numbers(f.text)));
      const shown = [...slide.bullets, ...slide.segments.map((s) => s.text)].flatMap(numbers);
      for (const n of shown) expect(factNumbers.has(n), `number ${n} on ${slide.id}`).toBe(true);
    },
  );

  it.each(slides)("%s: segments point at real bullets and are single sentences", (_, slide) => {
    for (const seg of slide.segments) {
      expect(slide.bullets[seg.bullet], seg.text).toBeDefined();
      expect(seg.text.split(/(?<=[.!?])\s+/).length, seg.text).toBe(1);
    }
  });

  it.each(slides)("%s: sizes follow brief §5", (_, slide) => {
    expect(slide.bullets.length).toBeGreaterThanOrEqual(3);
    expect(slide.bullets.length).toBeLessThanOrEqual(4);
    expect(slide.segments.length).toBeGreaterThanOrEqual(4);
    expect(slide.segments.length).toBeLessThanOrEqual(6);
    expect(slide.facts.length).toBeGreaterThanOrEqual(8);
    expect(slide.facts.length).toBeLessThanOrEqual(15);
  });

  it.each(slides)("%s: source ids are unique and urls are https", (_, slide) => {
    const ids = slide.sources.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of slide.sources) expect(s.url).toMatch(/^https:\/\//);
  });

  it("fact ids are unique across the deck", () => {
    const ids = deck.flatMap((s) => s.facts.map((f) => f.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("time-sensitive slide carries statusAsOf", () => {
    expect(deck.find((s) => s.id === "future")?.statusAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
