import { sessionInstructions } from "@ava/shared";
import { describe, expect, it } from "vitest";
import { createApp, type Deps } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { PAUSE_MS, createLimits } from "../src/limits.js";
import type { SidebandOptions } from "../src/sideband.js";
import { createStats } from "../src/stats.js";
import { createTurnstileVerifier } from "../src/turnstile.js";
import { FAKE_API_KEY, FAKE_CLIENT_SECRET, failingWith, fakeOpenAI } from "./fakes.js";

const HOSTED = {
  OPENAI_API_KEY: FAKE_API_KEY,
  SESSION_MAX_MINUTES: "10",
  MAX_CONCURRENT_SESSIONS: "1",
  DAILY_SESSIONS_PER_IP: "5",
  DAILY_SESSIONS_GLOBAL: "20",
  SIDEBAND: "1",
  TRUST_PROXY: "1",
  STATS_TOKEN: "stats-token-not-real",
};
const NOON = Date.UTC(2026, 9, 28, 12);

function make(extra: Partial<Deps> = {}, env: Record<string, string> = {}) {
  const config = loadConfig({ ...HOSTED, ...env });
  const lines: string[] = [];
  const clock = { now: NOON };
  const sidebands: (SidebandOptions & { closed: boolean })[] = [];
  const stats = createStats();
  const app = createApp({
    config,
    logger: createLogger((l) => lines.push(l)),
    openai: fakeOpenAI(),
    limits: createLimits(config),
    now: () => clock.now,
    stats,
    openSideband: (opts) => {
      const s = { ...opts, closed: false };
      sidebands.push(s);
      return { close: () => (s.closed = true) };
    },
    ...extra,
  });
  return { app, lines, clock, sidebands, stats };
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://local${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9", ...headers },
    body: JSON.stringify(body),
  });
const startSession = async (app: ReturnType<typeof make>["app"], body: object = {}) => {
  const res = await app.request(post("/api/session", body));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const health = async (app: ReturnType<typeof make>["app"]) =>
  ((await (await app.request("/api/health")).json()) as { limits: object }).limits;
const stats = (app: ReturnType<typeof make>["app"], token = HOSTED.STATS_TOKEN) =>
  app.request("/api/stats", { headers: { authorization: `Bearer ${token}` } });

describe("hosted demo routes", () => {
  it("runs start → call → reconnect → end with the sideband and the slot", async () => {
    const { app, sidebands, lines } = make();
    const first = await startSession(app);
    expect(first).toEqual({
      status: 200,
      body: {
        clientSecret: FAKE_CLIENT_SECRET,
        sessionId: expect.any(String),
        expiresAt: NOON + 10 * 60_000,
      },
    });
    const id = first.body["sessionId"] as string;
    expect(await health(app)).toEqual({ sessionMaxMinutes: 10, busy: true, paused: false });
    expect((await startSession(app)).body).toEqual({ code: "demo_busy" });

    const call = await app.request(post(`/api/session/${id}/call`, { callId: "rtc_1" }));
    expect(call.status).toBe(204);
    expect(sidebands).toHaveLength(1);
    expect(sidebands[0]).toMatchObject({
      apiKey: FAKE_API_KEY,
      callId: "rtc_1",
      expiresAt: NOON + 10 * 60_000,
      expectedTools: ["goto_slide", "resume_presentation", "offer_end", "end_presentation"],
    });
    const sent: object[] = [];
    sidebands[0]!.reapply((e) => sent.push(e));
    expect(sent[0]).toMatchObject({
      type: "session.update",
      session: { instructions: sidebands[0]!.expectedInstructions },
    });

    // A reconnect takes over the only slot, keeps expiresAt and closes the old sideband.
    const again = await startSession(app, { reconnectOf: id });
    expect(again.body["expiresAt"]).toBe(NOON + 10 * 60_000);
    expect(sidebands[0]!.closed).toBe(true);
    const newId = again.body["sessionId"] as string;
    await app.request(post(`/api/session/${newId}/call`, { callId: "rtc_2" }));
    expect(sidebands[1]!.callId).toBe("rtc_2");

    expect((await app.request(post(`/api/session/${newId}/end`, {}))).status).toBe(204);
    expect(sidebands[1]!.closed).toBe(true);
    expect(await health(app)).toMatchObject({ busy: false });
    expect(lines.join("\n")).not.toContain("203.0.113.9");
  });

  it("keeps the presenter's voice and instructions through the sideband and a reconnect", async () => {
    const minted: { instructions: string; audio: { output: { voice: string } } }[] = [];
    const { app, sidebands } = make({
      openai: fakeOpenAI({
        createClientSecret: async (session) => {
          minted.push(session as (typeof minted)[number]);
          return { value: FAKE_CLIENT_SECRET, expiresAt: 0 };
        },
      }),
    });
    const id = (await startSession(app, { persona: "theo" })).body["sessionId"] as string;
    await app.request(post(`/api/session/${id}/call`, { callId: "rtc_1" }));
    expect(sidebands[0]!.expectedInstructions).toBe(sessionInstructions("theo"));
    const sent: { session: { instructions: string } }[] = [];
    sidebands[0]!.reapply((e) => sent.push(e as (typeof sent)[number]));
    expect(sent[0]!.session.instructions).toBe(sessionInstructions("theo"));

    // A reconnect that asks for another presenter still gets the original one.
    const again = await startSession(app, { reconnectOf: id, persona: "mira" });
    expect(again.status).toBe(200);
    expect(minted.map((m) => m.audio.output.voice)).toEqual(["cedar", "cedar"]);
    expect(minted[1]!.instructions).toBe(sessionInstructions("theo"));
    await app.request(post(`/api/session/${again.body["sessionId"]}/call`, { callId: "rtc_2" }));
    expect(sidebands[1]!.expectedInstructions).toBe(sessionInstructions("theo"));
  });

  it("opens no sideband when SIDEBAND is off", async () => {
    const { app, sidebands } = make({}, { SIDEBAND: "0" });
    const { body } = await startSession(app);
    await app.request(post(`/api/session/${String(body["sessionId"])}/call`, { callId: "rtc_1" }));
    expect(sidebands).toHaveLength(0);
  });

  it("maps a budget 429 to demo_paused and reports paused on health for 10 minutes", async () => {
    const { app, clock } = make({
      openai: fakeOpenAI({ createClientSecret: failingWith(429, "insufficient_quota") }),
    });
    const res = await app.request(post("/api/session", {}));
    expect([res.status, await res.json()]).toEqual([503, { code: "demo_paused" }]);
    expect(await health(app)).toEqual({ sessionMaxMinutes: 10, busy: false, paused: true });
    clock.now += PAUSE_MS;
    expect(await health(app)).toMatchObject({ paused: false });
  });

  it("returns 403 bot_check_failed when the verifier rejects the token", async () => {
    const openai = fakeOpenAI();
    const { app } = make({ openai, verifyTurnstile: async () => false });
    const res = await app.request(post("/api/session", { turnstileToken: "bad" }));
    expect([res.status, await res.json()]).toEqual([403, { code: "bot_check_failed" }]);
    expect(openai.calls).not.toContain("createClientSecret");
  });

  it("wires a Turnstile verifier whose siteverify call fails into bot_check_failed", async () => {
    const verifyTurnstile = createTurnstileVerifier(
      "turnstile-secret-not-real",
      async () => new Response(JSON.stringify({ success: false }), { status: 200 }),
    );
    const { app } = make({ verifyTurnstile });
    expect((await startSession(app, { turnstileToken: "tok" })).body).toEqual({
      code: "bot_check_failed",
    });
  });
});

describe("GET /api/stats and POST /api/metrics", () => {
  it("needs the bearer token and is off without STATS_TOKEN", async () => {
    const { app } = make();
    expect((await app.request("/api/stats")).status).toBe(404);
    expect((await stats(app, "wrong")).status).toBe(404);
    expect((await stats(app)).status).toBe(200);
    const off = make({}, { STATS_TOKEN: "" });
    expect((await stats(off.app)).status).toBe(404);
  });

  it("returns counters only, with sideband flags and limit refusals", async () => {
    const { app, sidebands } = make();
    const { body } = await startSession(app);
    await startSession(app);
    await app.request(post(`/api/session/${String(body["sessionId"])}/call`, { callId: "rtc_1" }));
    sidebands[0]!.onFlag("unsourced_number");
    const res = await stats(app);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      counters: { session_started: 1, demo_busy: 1, flag_unsourced_number: 1 },
      metrics: {},
    });
    for (const s of ["203.0.113.9", "rtc_1", FAKE_CLIENT_SECRET]) expect(text).not.toContain(s);
  });

  it("validates metric reports and aggregates them", async () => {
    const { app } = make();
    const sessionId = "6f1c1d2e-8a1b-4c3d-9e4f-0a1b2c3d4e5f";
    const report = (p50: number, p90: number) =>
      post("/api/metrics", { sessionId, metrics: { answer_start_ms: { p50, p90, n: 3 } } });
    expect((await app.request(report(400, 900))).status).toBe(204);
    expect((await app.request(report(600, 700))).status).toBe(204);
    expect((await app.request(post("/api/metrics", { sessionId, text: "hi" }))).status).toBe(400);
    expect((await app.request(post("/api/metrics", "nope"))).status).toBe(400);
    expect(((await (await stats(app)).json()) as { metrics: object }).metrics).toEqual({
      answer_start_ms: { reports: 2, samples: 6, meanP50: 500, meanP90: 800, maxP90: 900 },
    });
  });

  it("accepts a beacon body sent as text/plain", async () => {
    const { app } = make();
    const body = JSON.stringify({
      sessionId: "6f1c1d2e-8a1b-4c3d-9e4f-0a1b2c3d4e5f",
      metrics: { m: { p50: 1, p90: 2, n: 1 } },
    });
    const res = await app.request(
      new Request("http://local/api/metrics", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body,
      }),
    );
    expect(res.status).toBe(204);
  });
});
