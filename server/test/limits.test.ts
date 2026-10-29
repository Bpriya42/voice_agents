import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { PAUSE_MS, createLimits, hasHostedLimits } from "../src/limits.js";

const HOSTED = {
  SESSION_MAX_MINUTES: "10",
  MAX_CONCURRENT_SESSIONS: "5",
  DAILY_SESSIONS_PER_IP: "5",
  DAILY_SESSIONS_GLOBAL: "20",
};
const MIN = 60_000;
/** 2026-10-28T12:00:00Z, a fake clock: every call passes `now` explicitly. */
const NOON = Date.UTC(2026, 9, 28, 12);

function make(env: Record<string, string> = HOSTED) {
  const expired: [string, string | undefined][] = [];
  const limits = createLimits(loadConfig(env), (id, callId) => expired.push([id, callId]));
  let n = 0;
  const start = (ip: string, now = NOON, reconnectOf?: string, persona?: "ava" | "theo" | "mira") =>
    limits.tryStart({ ip, now, sessionId: `s${++n}`, reconnectOf, persona });
  return { limits, expired, start };
}

describe("createLimits", () => {
  it("is chosen only when a hosted limit is set", () => {
    expect(hasHostedLimits(loadConfig({}))).toBe(false);
    expect(hasHostedLimits(loadConfig({ DAILY_SESSIONS_GLOBAL: "20" }))).toBe(true);
  });

  it("refuses the 6th concurrent session with demo_busy and reports busy", () => {
    const { limits, start } = make();
    for (let i = 0; i < 5; i++) expect(start(`10.0.0.${i}`).ok).toBe(true);
    expect(limits.status(NOON)).toEqual({ busy: true, paused: false });
    expect(start("10.0.0.9")).toEqual({ ok: false, code: "demo_busy" });
    limits.end("s1");
    expect(start("10.0.0.9").ok).toBe(true);
  });

  it("refuses the 6th session from one IP in a day with quota_reached", () => {
    const { limits, start } = make();
    for (let i = 1; i <= 5; i++) {
      expect(start("198.51.100.7").ok).toBe(true);
      limits.end(`s${i}`);
    }
    expect(start("198.51.100.7")).toEqual({ ok: false, code: "quota_reached" });
    expect(start("198.51.100.8").ok).toBe(true);
  });

  it("enforces the global daily cap across IPs", () => {
    const { limits, start } = make();
    for (let i = 1; i <= 20; i++) {
      expect(start(`10.0.1.${i}`).ok).toBe(true);
      limits.end(`s${i}`);
    }
    expect(start("10.0.2.1")).toEqual({ ok: false, code: "quota_reached" });
  });

  it("resets the daily quotas at 00:00 UTC", () => {
    const { limits, start } = make();
    const beforeMidnight = Date.UTC(2026, 9, 28, 23, 59, 59);
    for (let i = 1; i <= 5; i++) {
      start("198.51.100.7", beforeMidnight);
      limits.end(`s${i}`);
    }
    expect(start("198.51.100.7", beforeMidnight)).toEqual({ ok: false, code: "quota_reached" });
    expect(start("198.51.100.7", Date.UTC(2026, 9, 29, 0, 0, 0)).ok).toBe(true);
  });

  it("sets expiresAt from SESSION_MAX_MINUTES, or null without it", () => {
    expect(make().start("a")).toMatchObject({ ok: true, expiresAt: NOON + 10 * MIN });
    expect(make({ DAILY_SESSIONS_GLOBAL: "20" }).start("a")).toMatchObject({ expiresAt: null });
  });

  it("lets a reconnect take over the slot, keep expiresAt and skip the quota", () => {
    const { limits, start } = make({ ...HOSTED, MAX_CONCURRENT_SESSIONS: "1" });
    const first = start("198.51.100.7");
    expect(limits.attachCall("s1", "rtc_old")).toBe(true);
    // The only slot is taken, so only a reconnect can get in.
    expect(start("198.51.100.8")).toEqual({ ok: false, code: "demo_busy" });
    const again = start("198.51.100.7", NOON + 3 * MIN, "s1");
    expect(again).toEqual({
      ok: true,
      sessionId: "s3",
      expiresAt: first.ok ? first.expiresAt : -1,
      persona: "ava",
    });
    expect(limits.session("s1")).toBeUndefined();
    // The new session waits for its own call_id.
    expect(limits.session("s3")).toEqual({ expiresAt: NOON + 10 * MIN, persona: "ava" });
    // No quota charge: four more fresh sessions from this IP still fit the per-IP cap of 5.
    limits.end("s3");
    for (let i = 0; i < 4; i++) {
      const r = start("198.51.100.7");
      expect(r.ok).toBe(true);
      if (r.ok) limits.end(r.sessionId);
    }
    expect(start("198.51.100.7")).toEqual({ ok: false, code: "quota_reached" });
  });

  it("keeps the original presenter when a reconnect asks for another", () => {
    const { limits, start } = make();
    expect(start("a", NOON, undefined, "theo")).toMatchObject({ ok: true, persona: "theo" });
    expect(start("a", NOON + MIN, "s1", "mira")).toMatchObject({ ok: true, persona: "theo" });
    expect(limits.session("s2")).toMatchObject({ persona: "theo" });
  });

  it("treats an unknown reconnectOf as a new session", () => {
    const { limits, start } = make({ ...HOSTED, DAILY_SESSIONS_PER_IP: "1" });
    expect(start("a", NOON, "missing").ok).toBe(true);
    limits.end("s1");
    expect(start("a", NOON, "missing")).toEqual({ ok: false, code: "quota_reached" });
  });

  it("frees expired sessions and calls onExpire with their call id", () => {
    const { limits, expired, start } = make({ ...HOSTED, MAX_CONCURRENT_SESSIONS: "1" });
    start("a");
    limits.attachCall("s1", "rtc_1");
    expect(start("b", NOON + 10 * MIN - 1)).toEqual({ ok: false, code: "demo_busy" });
    expect(expired).toEqual([]);
    expect(start("b", NOON + 10 * MIN).ok).toBe(true);
    expect(expired).toEqual([["s1", "rtc_1"]]);
    expect(limits.session("s1")).toBeUndefined();
  });

  it("keeps a slot with no call_id until expiresAt, and frees it from status()", () => {
    const { limits, expired, start } = make({ ...HOSTED, MAX_CONCURRENT_SESSIONS: "1" });
    start("a");
    expect(limits.status(NOON + 5 * MIN).busy).toBe(true);
    expect(limits.status(NOON + 10 * MIN).busy).toBe(false);
    expect(expired).toEqual([["s1", undefined]]);
  });

  it("is paused for 10 minutes after a demo_paused mapping", () => {
    const { limits } = make();
    limits.pause(NOON);
    expect(limits.status(NOON + PAUSE_MS - 1).paused).toBe(true);
    expect(limits.status(NOON + PAUSE_MS).paused).toBe(false);
  });

  it("applies the per-minute request rate per IP", () => {
    const { limits } = make({ ...HOSTED, RATE_LIMIT_PER_MIN: "1" });
    expect(limits.allowRequest("a", NOON)).toBe(true);
    expect(limits.allowRequest("a", NOON + 1)).toBe(false);
    expect(limits.allowRequest("b", NOON + 1)).toBe(true);
    expect(limits.allowRequest("a", NOON + MIN)).toBe(true);
  });

  it("never stores raw IPs", () => {
    const { limits, start } = make();
    const ips = ["203.0.113.9", "2001:db8::1"];
    for (const ip of ips) start(ip);
    const { activeIps, dailyIps } = limits.inspect();
    expect(activeIps).toHaveLength(2);
    expect(dailyIps).toHaveLength(2);
    const stored = JSON.stringify(limits.inspect());
    for (const ip of ips) expect(stored).not.toContain(ip);
    for (const h of [...activeIps, ...dailyIps]) expect(h).toMatch(/^[0-9a-f]{8}$/);
  });
});
