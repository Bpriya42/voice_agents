import { describe, expect, it } from "vitest";
import { createLocalLimits } from "./limits.js";

describe("createLocalLimits", () => {
  it("allows RATE_LIMIT_PER_MIN requests per ip per window, then resets", () => {
    const l = createLocalLimits({ RATE_LIMIT_PER_MIN: 2 });
    expect([l.allowRequest("a", 0), l.allowRequest("a", 1), l.allowRequest("a", 2)]).toEqual([
      true,
      true,
      false,
    ]);
    expect(l.allowRequest("b", 3)).toBe(true);
    expect(l.allowRequest("a", 59_999)).toBe(false);
    expect(l.allowRequest("a", 60_000)).toBe(true);
  });

  it("prunes expired windows so memory stays bounded", () => {
    const l = createLocalLimits({ RATE_LIMIT_PER_MIN: 1 });
    for (let i = 0; i < 1_100; i++) l.allowRequest(`ip${i}`, 0);
    // A request long after the window prunes; the old ip starts a fresh window.
    expect(l.allowRequest("ip0", 120_000)).toBe(true);
    expect(l.allowRequest("ip0", 120_001)).toBe(false);
  });

  it("always starts sessions with no expiry and tracks them", () => {
    const l = createLocalLimits({ RATE_LIMIT_PER_MIN: 10 });
    expect(l.tryStart({ ip: "a", now: 0, sessionId: "s1" })).toEqual({
      ok: true,
      sessionId: "s1",
      expiresAt: null,
      persona: "ava",
    });
    expect(l.attachCall("s1", "call_1")).toBe(true);
    expect(l.attachCall("unknown", "call_1")).toBe(false);
    l.end("s1");
    expect(l.attachCall("s1", "call_2")).toBe(false);
    expect(() => l.end("s1")).not.toThrow();
  });

  it("keeps the requested presenter, and the original one on a reconnect", () => {
    const l = createLocalLimits({ RATE_LIMIT_PER_MIN: 10 });
    expect(l.tryStart({ ip: "a", now: 0, sessionId: "s1", persona: "theo" })).toMatchObject({
      persona: "theo",
    });
    expect(l.session("s1")).toMatchObject({ persona: "theo" });
    const again = l.tryStart({
      ip: "a",
      now: 1,
      sessionId: "s2",
      reconnectOf: "s1",
      persona: "mira",
    });
    expect(again).toMatchObject({ persona: "theo" });
    expect(l.tryStart({ ip: "a", now: 2, sessionId: "s3", reconnectOf: "gone" })).toMatchObject({
      persona: "ava",
    });
  });

  it("is never busy or paused locally", () => {
    expect(createLocalLimits({ RATE_LIMIT_PER_MIN: 1 }).status(0)).toEqual({
      busy: false,
      paused: false,
    });
  });
});
