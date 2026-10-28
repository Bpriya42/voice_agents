import { describe, expect, it } from "vitest";
import { createOnsetDetector, createSilenceDetector } from "./silence.js";

describe("silence detector", () => {
  it("a dip shorter than the minimum is not silence", () => {
    const d = createSilenceDetector({ threshold: 0.01, minMs: 100 });
    expect(d.feed(0.5, 0)).toBeNull();
    expect(d.feed(0, 20)).toBeNull();
    expect(d.feed(0, 60)).toBeNull();
    expect(d.feed(0.5, 80)).toBeNull(); // sound again after 60 ms: the run resets
    expect(d.feed(0, 100)).toBeNull();
    expect(d.feed(0, 150)).toBeNull();
  });
  it("reports when the silent run began once it lasts long enough", () => {
    const d = createSilenceDetector({ threshold: 0.01, minMs: 100 });
    expect(d.feed(0, 1000)).toBeNull();
    expect(d.feed(0, 1060)).toBeNull();
    expect(d.feed(0, 1100)).toBe(1000);
  });
});

describe("onset detector", () => {
  it("needs two consecutive frames above the threshold", () => {
    const d = createOnsetDetector({ threshold: 0.01, frames: 2 });
    expect(d.feed(0.5, 0)).toBeNull();
    expect(d.feed(0, 20)).toBeNull(); // a single stray frame
    expect(d.feed(0.5, 40)).toBeNull();
    expect(d.feed(0.5, 60)).toBe(40); // time of the run's first frame
  });
});
