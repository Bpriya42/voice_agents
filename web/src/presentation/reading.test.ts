import { deck } from "@ava/shared";
import { describe, expect, it } from "vitest";
import { READING_BASE_MS, readingMs } from "./reading.js";

describe("readingMs", () => {
  it("gives a base time plus 200 words per minute", () => {
    expect(readingMs("")).toBe(READING_BASE_MS);
    expect(readingMs("one two three four five")).toBe(READING_BASE_MS + 1_500);
    expect(readingMs("  spaced\n  out   words ")).toBe(READING_BASE_MS + 900);
  });

  it("is slower than speech, so at normal speech pace the audio is already longer", () => {
    for (const s of deck.flatMap((d) => d.segments)) {
      const words = s.text.split(/\s+/).length;
      const speechMs = (words * 60_000) / 150;
      expect(readingMs(s.text)).toBeLessThanOrEqual(speechMs + READING_BASE_MS);
    }
  });
});
