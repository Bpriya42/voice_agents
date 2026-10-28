import { describe, expect, it } from "vitest";
import { percentile } from "./percentile.js";

describe("percentile", () => {
  it("returns null for no values", () => expect(percentile([], 50)).toBeNull());
  it("returns the only value for any p", () => {
    expect(percentile([42], 0)).toBe(42);
    expect(percentile([42], 90)).toBe(42);
  });
  it("interpolates between ranks and ignores input order", () => {
    expect(percentile([40, 10, 30, 20], 50)).toBe(25);
    expect(percentile([10, 20, 30, 40, 50], 90)).toBe(46);
  });
  it("does not mutate its input", () => {
    const v = [3, 1, 2];
    percentile(v, 50);
    expect(v).toEqual([3, 1, 2]);
  });
});
