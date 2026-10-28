import { describe, expect, it } from "vitest";
import { createSpeechDetector, meterValue, micErrorCode, rms } from "./micLevel.js";

describe("rms", () => {
  it("of a constant signal is its magnitude", () => {
    expect(rms(new Float32Array(128).fill(0.5))).toBeCloseTo(0.5);
    expect(rms(new Float32Array(128).fill(-0.25))).toBeCloseTo(0.25);
  });
  it("of silence or an empty buffer is 0", () => {
    expect(rms(new Float32Array(64))).toBe(0);
    expect(rms(new Float32Array(0))).toBe(0);
  });
});

describe("createSpeechDetector", () => {
  it("needs 300 ms above threshold", () => {
    const d = createSpeechDetector();
    expect(d(0.1, 0)).toBe(false);
    expect(d(0.1, 299)).toBe(false);
    expect(d(0.1, 300)).toBe(true);
  });
  it("resets on a dip", () => {
    const d = createSpeechDetector();
    d(0.1, 0);
    d(0.1, 250);
    expect(d(0.001, 260)).toBe(false);
    expect(d(0.1, 270)).toBe(false);
    expect(d(0.1, 560)).toBe(false);
    expect(d(0.1, 570)).toBe(true);
  });
  it("respects custom options", () => {
    const d = createSpeechDetector({ threshold: 0.5, holdMs: 10 });
    expect(d(0.4, 0)).toBe(false);
    d(0.6, 0);
    expect(d(0.6, 10)).toBe(true);
  });
});

describe("meterValue and micErrorCode", () => {
  it("clamps the meter to 0..1", () => {
    expect(meterValue(0)).toBe(0);
    expect(meterValue(10)).toBe(1);
  });
  it("maps getUserMedia errors to stable codes", () => {
    expect(micErrorCode({ name: "NotAllowedError" })).toBe("mic_denied");
    expect(micErrorCode({ name: "NotFoundError" })).toBe("mic_not_found");
    expect(micErrorCode(new Error("x"))).toBe("mic_error");
    expect(micErrorCode(null)).toBe("mic_error");
  });
});
