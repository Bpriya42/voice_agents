import { describe, expect, it } from "vitest";
import { MetricsRecorder } from "./recorder.js";

describe("MetricsRecorder", () => {
  it("measures start to stop and summarizes", () => {
    const r = new MetricsRecorder(() => 0);
    for (const ms of [100, 200, 300]) {
      r.start("answerLatency", 0);
      r.stop("answerLatency", ms);
    }
    expect(r.summary().answerLatency).toEqual({ p50: 200, p90: 280, n: 3 });
  });
  it("ignores a stop without a start", () => {
    const r = new MetricsRecorder(() => 5);
    expect(r.stop("greeting")).toBeNull();
    expect(r.summary()).toEqual({});
  });
  it("a stop consumes its start", () => {
    const r = new MetricsRecorder(() => 0);
    r.start("greeting", 0);
    r.stop("greeting", 10);
    expect(r.stop("greeting", 20)).toBeNull();
    expect(r.summary().greeting?.n).toBe(1);
  });
  it("cancel drops a running mark; negative samples are dropped", () => {
    const r = new MetricsRecorder(() => 0);
    r.start("bargeIn", 0);
    r.cancel("bargeIn");
    expect(r.stop("bargeIn", 50)).toBeNull();
    r.start("bargeIn", 100);
    expect(r.stop("bargeIn", 90)).toBeNull();
    expect(r.summary()).toEqual({});
  });
});
