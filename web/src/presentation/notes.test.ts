import { describe, expect, it } from "vitest";
import { slideById } from "@ava/shared";
import { initialNotes, noteForPlayed, prunePlan, type NotesState } from "./notes.js";

const intro = slideById("intro");
const last = intro.segments.length - 1;

describe("slide notes (arch §5.10 table)", () => {
  it("every sentence played → full note", () => {
    expect(noteForPlayed(initialNotes(), intro, last)).toEqual({
      add: `Presented slide 1, What is GLP-1?: ${intro.summary}`,
    });
  });

  it("interrupted after at least one sentence → partial note", () => {
    expect(noteForPlayed(initialNotes(), intro, 0)).toEqual({
      add: "Partly presented slide 1, up to sentence 1.",
    });
  });

  it("interrupted before the first sentence → no note", () => {
    expect(noteForPlayed(initialNotes(), intro, -1)).toEqual({});
  });

  it("a partly presented slide completes → the partial note is replaced", () => {
    const s: NotesState = { ...initialNotes(), notes: { intro: { itemId: "n1", full: false } } };
    expect(noteForPlayed(s, intro, last)).toMatchObject({
      remove: "n1",
      add: expect.stringContaining("Presented slide 1"),
    });
  });

  it("a slide narrated again keeps its full note; a second partial adds nothing", () => {
    const full: NotesState = { ...initialNotes(), notes: { intro: { itemId: "n1", full: true } } };
    expect(noteForPlayed(full, intro, last)).toEqual({});
    expect(noteForPlayed(full, intro, 1)).toEqual({});
    const partial: NotesState = {
      ...initialNotes(),
      notes: { intro: { itemId: "n1", full: false } },
    };
    expect(noteForPlayed(partial, intro, 1)).toEqual({});
  });
});

describe("pruning", () => {
  const pair = (i: number) => ({ itemIds: [`u${i}`, `a${i}`], factIds: [`fact-${i}`] });

  it("keeps up to six pairs", () => {
    const s: NotesState = { ...initialNotes(), qaPairs: [1, 2, 3, 4, 5, 6].map(pair) };
    expect(prunePlan(s).delete).toEqual([]);
  });

  it("drops the oldest pairs and replaces the previous prune note, using fact ids only", () => {
    const s: NotesState = {
      notes: {},
      qaPairs: [1, 2, 3, 4, 5, 6, 7, 8].map(pair),
      pruneNoteId: "old-note",
    };
    const plan = prunePlan(s);
    expect(plan.delete).toEqual(["u1", "a1", "u2", "a2", "old-note"]);
    expect(plan.note).toBe("Earlier questions were answered from facts fact-1, fact-2.");
    expect(plan.keep).toHaveLength(6);
    expect(plan.keep[0]!.itemIds).toEqual(["u3", "a3"]);
  });

  it("never includes user text", () => {
    const s: NotesState = {
      ...initialNotes(),
      qaPairs: Array.from({ length: 7 }, (_, i) => ({ itemIds: [`u${i}`], factIds: [] })),
    };
    expect(prunePlan(s).note).toBe("Earlier questions were answered from facts none.");
  });
});
