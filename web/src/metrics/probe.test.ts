import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAudioProbe } from "./probe.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("audio probe", () => {
  it("fires the sound waiter once at the first audible frame", () => {
    let level = 0;
    const probe = createAudioProbe({ level: () => level, now: () => Date.now() });
    const seen: number[] = [];
    probe.onSound((at) => seen.push(at));
    vi.advanceTimersByTime(100);
    expect(seen).toEqual([]);
    const t0 = Date.now();
    level = 0.3;
    vi.advanceTimersByTime(100);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeGreaterThanOrEqual(t0);
    expect(seen[0]).toBeLessThanOrEqual(t0 + 40);
  });
  it("silence waiter fires with the start of the silent run", () => {
    let level = 0.3;
    const probe = createAudioProbe({ level: () => level, now: () => Date.now() });
    const seen: number[] = [];
    probe.onSilence((at) => seen.push(at));
    vi.advanceTimersByTime(100);
    expect(seen).toEqual([]);
    const t0 = Date.now();
    level = 0;
    vi.advanceTimersByTime(300);
    expect(seen).toHaveLength(1);
    expect(seen[0]! - t0).toBeLessThanOrEqual(40);
  });
  it("cancel drops waiters and stops polling", () => {
    let calls = 0;
    const probe = createAudioProbe({ level: () => (calls++, 0.3) });
    const fn = vi.fn();
    probe.onSound(fn);
    probe.cancel();
    vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
    expect(calls).toBe(0);
  });
});
