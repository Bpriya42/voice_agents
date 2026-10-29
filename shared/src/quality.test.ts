import { describe, expect, it } from "vitest";
import { DOSING_PATTERN, qualityFlags } from "./quality.js";

describe("qualityFlags", () => {
  it("is empty for a grounded short answer", () => {
    expect(qualityFlags("In STEP-1 the average was 14.9%, shown on slide 5.")).toEqual([]);
  });

  it("flags unsourced numbers, dosing advice and answers over four sentences", () => {
    expect(qualityFlags("Most people lose 63%.")).toEqual(["unsourced_number"]);
    expect(qualityFlags("You should start 2.4 mg.")).toEqual(["dosing_pattern"]);
    expect(qualityFlags("A. B. C. D. E.")).toEqual(["over_4_sentences"]);
  });

  it("matches dosing advice written with a typographic apostrophe", () => {
    expect(DOSING_PATTERN.test("you could take 1 mg")).toBe(true);
    expect(qualityFlags("Here’s my advice: you can begin at 0.25 mg.")).toContain("dosing_pattern");
  });
});
