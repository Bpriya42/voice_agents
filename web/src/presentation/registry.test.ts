import { describe, expect, it, vi } from "vitest";
import { audioSettled, Registry } from "./registry.js";
import { Timers } from "./timers.js";

describe("Registry", () => {
  it("reserves before sending and maps responses back to requests", () => {
    const r = new Registry();
    r.bumpEpoch();
    const rec = r.reserve({ requestId: "q1", turnId: null, kind: "narration" });
    expect(r.generating()).toBe(rec);
    r.attach("q1", "resp_1");
    expect(r.byResponseId("resp_1")).toBe(rec);
    expect(r.byResponseId("nope")).toBeUndefined();
    expect(r.attach("missing", "x")).toBeUndefined();
  });

  it("epochs: a bump clears records and rejects older events", () => {
    const r = new Registry();
    expect(r.bumpEpoch()).toBe(1);
    r.reserve({ requestId: "q1", turnId: null, kind: "answer" });
    r.bumpEpoch();
    expect(r.get("q1")).toBeUndefined();
    expect(r.isCurrent({ sessionEpoch: 1 })).toBe(false);
    expect(r.isCurrent({ sessionEpoch: 2 })).toBe(true);
  });

  it("cancelInFlight marks generating and playing records, not finished ones", () => {
    const r = new Registry();
    const a = r.reserve({ requestId: "a", turnId: null, kind: "narration" });
    const b = r.reserve({ requestId: "b", turnId: null, kind: "narration" });
    const c = r.reserve({ requestId: "c", turnId: null, kind: "narration" });
    b.generation = "done";
    b.playback = "playing";
    c.generation = "done";
    c.playback = "completed";
    r.cancelInFlight();
    expect([a.generation, a.cancelled]).toEqual(["cancelling", true]);
    expect([b.generation, b.cancelled]).toEqual(["done", true]);
    expect(c.cancelled).toBe(false);
    expect(r.playing()).toBe(b);
  });

  it("audioSettled waits for playback unless the response had no audio", () => {
    const r = new Registry();
    const rec = r.reserve({ requestId: "a", turnId: null, kind: "answer" });
    expect(audioSettled(rec)).toBe(false);
    rec.generation = "done";
    expect(audioSettled(rec)).toBe(true);
    rec.hadAudio = true;
    expect(audioSettled(rec)).toBe(false);
    rec.playback = "playing";
    expect(audioSettled(rec)).toBe(false);
    rec.playback = "cleared";
    expect(audioSettled(rec)).toBe(true);
  });
});

describe("Timers", () => {
  const make = (current = { epoch: 1, turnId: null as string | null }) => {
    vi.useFakeTimers();
    return new Timers(
      {
        schedule: (fn, ms) => setTimeout(fn, ms),
        cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      },
      (s) => s.epoch === current.epoch && (s.turnId === null || s.turnId === current.turnId),
    );
  };

  it("fires once, and setting a name again replaces the timer", () => {
    const t = make();
    const fn = vi.fn();
    t.set("resume", 100, { epoch: 1, turnId: null }, fn);
    t.set("resume", 200, { epoch: 1, turnId: null }, fn);
    vi.advanceTimersByTime(150);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(t.has("resume")).toBe(false);
    vi.useRealTimers();
  });

  it("does not fire when its scope is no longer current", () => {
    const current = { epoch: 1, turnId: "t1" as string | null };
    const t = make(current);
    const fn = vi.fn();
    t.set("thinkTimeout", 100, { epoch: 1, turnId: "t1" }, fn);
    current.turnId = "t2";
    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("clearScope and clearAll cancel matching timers", () => {
    const t = make();
    const fn = vi.fn();
    t.set("thinkSlow", 100, { epoch: 1, turnId: "a" }, fn);
    t.set("thinkTimeout", 100, { epoch: 1, turnId: "b" }, fn);
    t.set("resume", 100, { epoch: 2, turnId: null }, fn);
    t.clearScope({ turnId: "a" });
    expect(t.size).toBe(2);
    t.clearScope({ epoch: 2 });
    expect(t.size).toBe(1);
    t.clearAll();
    expect(t.size).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
