import { describe, expect, it } from "vitest";
import { deck } from "@ava/shared";
import { matchSources, numbersIn } from "./matchSources.js";

describe("numbersIn", () => {
  it("ignores digits in names like GLP-1, STEP-1, type 2, MEN 2 and phase 3", () => {
    expect(numbersIn("GLP-1 in STEP-1 for type 2 diabetes, MEN 2, phase 3")).toEqual([]);
  });

  it("finds decimals and thousands", () => {
    expect(numbersIn("14.9% of 1,961 people, 2.4%")).toEqual(["14.9", "1961", "2.4"]);
  });
});

describe("matchSources", () => {
  it("maps STEP-1 weight loss numbers to the STEP-1 source", () => {
    const m = matchSources(
      "People lost 14.9 percent on semaglutide versus 2.4 percent on placebo.",
      deck,
    );
    expect(m.factIds).toEqual(["evid-2"]);
    expect(m.sources).toEqual(["STEP-1, Wilding, NEJM 2021"]);
    expect(m.unsourced).toEqual([]);
  });

  it("covers numbers from two trials with two facts", () => {
    const m = matchSources("STEP-1 averaged 14.9 percent; SURMOUNT-1 reached 20.9 percent.", deck);
    expect(m.factIds).toHaveLength(2);
    expect(m.sources).toEqual(
      expect.arrayContaining(["STEP-1, Wilding, NEJM 2021", "SURMOUNT-1, Jastreboff, NEJM 2022"]),
    );
  });

  it("flags numbers that no reviewed fact contains", () => {
    const m = matchSources("People lose 31.7 percent.", deck);
    expect(m.factIds).toEqual([]);
    expect(m.unsourced).toEqual(["31.7"]);
  });

  it("returns nothing for answers without numbers", () => {
    expect(matchSources("It slows the stomach.", deck)).toEqual({
      factIds: [],
      sources: [],
      unsourced: [],
    });
  });
});
