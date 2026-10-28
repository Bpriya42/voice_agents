import { describe, expect, it } from "vitest";
import { dockQuiet } from "./useIdle.js";

describe("dockQuiet", () => {
  it("dims only when idle", () => {
    expect(dockQuiet({ idle: true, focused: false, attention: false })).toBe(true);
    expect(dockQuiet({ idle: false, focused: false, attention: false })).toBe(false);
  });

  it("stays lit while something inside has focus", () => {
    expect(dockQuiet({ idle: true, focused: true, attention: false })).toBe(false);
  });

  it("stays lit while a notice or pause needs attention", () => {
    expect(dockQuiet({ idle: true, focused: false, attention: true })).toBe(false);
  });
});
