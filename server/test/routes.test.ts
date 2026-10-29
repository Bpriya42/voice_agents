import { chatSystemPrompt, sessionInstructions } from "@ava/shared";
import { describe, expect, it } from "vitest";
import { createApp, type Deps } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { createLocalLimits } from "../src/limits.js";
import {
  FAKE_API_KEY,
  FAKE_CLIENT_SECRET,
  failingWith,
  fakeOpenAI,
  type FakeOpenAI,
} from "./fakes.js";

function make(
  openai: FakeOpenAI | null = fakeOpenAI(),
  env: Record<string, string> = {},
  extra: Partial<Deps> = {},
) {
  const config = loadConfig({ ...(openai ? { OPENAI_API_KEY: FAKE_API_KEY } : {}), ...env });
  const lines: string[] = [];
  const logger = createLogger((l) => lines.push(l));
  const limits = createLocalLimits(config);
  const app = createApp({ config, logger, openai, limits, ...extra });
  return { app, lines, limits, config };
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://local${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("GET /api/health", () => {
  it("reports not configured without a key", async () => {
    const { app } = make(null);
    const body = await (await app.request("/api/health")).json();
    expect(body).toMatchObject({ configured: false, keyValid: null });
  });

  it("treats the .env.example placeholder as no key", async () => {
    const config = loadConfig({ OPENAI_API_KEY: "replace-with-your-key" });
    expect(config.OPENAI_API_KEY).toBeUndefined();
  });

  it("reports a valid key and exposes no secrets", async () => {
    const { app } = make(fakeOpenAI(), {
      TURNSTILE_SECRET_KEY: "turnstile-secret-not-real",
      STATS_TOKEN: "stats-token-not-real",
    });
    const res = await app.request("/api/health");
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ configured: true, keyValid: true });
    for (const secret of [FAKE_API_KEY, "turnstile-secret-not-real", "stats-token-not-real"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("reports a rejected key as keyValid false", async () => {
    const { app } = make(fakeOpenAI({ checkModel: async () => "unauthorized" }));
    expect(await (await app.request("/api/health")).json()).toMatchObject({
      configured: true,
      keyValid: false,
    });
  });

  it("reports an OpenAI outage as unknown, not as a bad key", async () => {
    const { app } = make(fakeOpenAI({ checkModel: async () => "error" }));
    expect(await (await app.request("/api/health")).json()).toMatchObject({ keyValid: null });
  });

  it("checks the key once, not on every request", async () => {
    const openai = fakeOpenAI();
    const { app } = make(openai);
    await app.request("/api/health");
    await app.request("/api/health");
    expect(openai.calls.filter((c) => c === "checkModel")).toHaveLength(1);
  });

  it("serves public config values and limits", async () => {
    const { app } = make(
      fakeOpenAI(),
      {
        TURNSTILE_SITE_KEY: "site-key-public",
        PUBLIC_REPO_URL: "https://github.com/example/repo",
        SESSION_MAX_MINUTES: "10",
      },
      {},
    );
    expect(await (await app.request("/api/health")).json()).toMatchObject({
      limits: { sessionMaxMinutes: 10, busy: false, paused: false },
      public: { turnstileSiteKey: "site-key-public", repoUrl: "https://github.com/example/repo" },
    });
  });

  it("sets security headers and no CORS headers", async () => {
    const res = await make().app.request("/api/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("POST /api/session", () => {
  it("returns a client secret and session id", async () => {
    const res = await make().app.request(post("/api/session", {}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      clientSecret: FAKE_CLIENT_SECRET,
      sessionId: expect.stringMatching(UUID),
      expiresAt: null,
    });
  });

  it("mints the key with the shared session config for the configured model and voice", async () => {
    let seen: unknown;
    let seconds: number | undefined;
    const openai = fakeOpenAI({
      createClientSecret: async (session, s) => {
        seen = session;
        seconds = s;
        return { value: FAKE_CLIENT_SECRET, expiresAt: 0 };
      },
    });
    await make(openai, {
      OPENAI_REALTIME_MODEL: "m-test",
      OPENAI_REALTIME_VOICE: "v-test",
    }).app.request(post("/api/session", {}));
    expect(seconds).toBe(60);
    expect(seen).toMatchObject({
      type: "realtime",
      model: "m-test",
      audio: { output: { voice: "v-test" }, input: { turn_detection: null } },
      tools: [
        { name: "goto_slide" },
        { name: "resume_presentation" },
        { name: "offer_end" },
        { name: "end_presentation" },
      ],
    });
  });

  it("defaults to Ava with the configured voice", async () => {
    let seen: { instructions: string; audio: { output: { voice: string } } } | undefined;
    const openai = fakeOpenAI({
      createClientSecret: async (session) => {
        seen = session as typeof seen;
        return { value: FAKE_CLIENT_SECRET, expiresAt: 0 };
      },
    });
    await make(openai, { OPENAI_REALTIME_VOICE: "v-test" }).app.request(post("/api/session", {}));
    expect(seen?.audio.output.voice).toBe("v-test");
    expect(seen?.instructions).toBe(sessionInstructions());
  });

  it.each([
    ["theo", "cedar", "Theo"],
    ["mira", "coral", "Mira"],
  ] as const)("mints %s with the %s voice and their own name", async (persona, voice, name) => {
    let seen: { instructions: string; audio: { output: { voice: string } } } | undefined;
    const openai = fakeOpenAI({
      createClientSecret: async (session) => {
        seen = session as typeof seen;
        return { value: FAKE_CLIENT_SECRET, expiresAt: 0 };
      },
    });
    const { app, lines } = make(openai, { OPENAI_REALTIME_VOICE: "v-test" });
    expect((await app.request(post("/api/session", { persona }))).status).toBe(200);
    expect(seen?.audio.output.voice).toBe(voice);
    expect(seen?.instructions).toBe(sessionInstructions(persona));
    expect(seen?.instructions).toContain(`You are ${name},`);
    expect(lines.join("\n")).toContain(`"persona":"${persona}"`);
  });

  it("rejects an unknown presenter without minting a key", async () => {
    let calls = 0;
    const openai = fakeOpenAI({
      createClientSecret: async () => {
        calls++;
        return { value: FAKE_CLIENT_SECRET, expiresAt: 0 };
      },
    });
    const res = await make(openai).app.request(post("/api/session", { persona: "bob" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "bad_request" });
    expect(calls).toBe(0);
  });

  it("returns not_configured without a key and never calls OpenAI", async () => {
    const res = await make(null).app.request(post("/api/session", {}));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: "not_configured" });
  });

  it.each([
    [401, undefined, 503, "not_configured"],
    [429, "insufficient_quota", 503, "quota"],
    [429, "rate_limit_exceeded", 429, "rate_limited"],
    [500, undefined, 502, "session_failed"],
  ])("maps OpenAI %s %s to %s %s", async (upstream, code, status, expected) => {
    const { app } = make(fakeOpenAI({ createClientSecret: failingWith(upstream, code) }));
    const res = await app.request(post("/api/session", {}));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ code: expected });
  });

  it("maps a network failure to session_failed", async () => {
    const { app } = make(
      fakeOpenAI({
        createClientSecret: async () => {
          throw new TypeError("fetch failed");
        },
      }),
    );
    const res = await app.request(post("/api/session", {}));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ code: "session_failed" });
  });

  it("reports demo_paused instead of quota when hosted", async () => {
    const { app } = make(
      fakeOpenAI({ createClientSecret: failingWith(429, "insufficient_quota") }),
      {
        SESSION_MAX_MINUTES: "10",
      },
    );
    expect(await (await app.request(post("/api/session", {}))).json()).toEqual({
      code: "demo_paused",
    });
  });

  it("rejects unknown fields and a non-uuid reconnectOf", async () => {
    const { app } = make();
    expect((await app.request(post("/api/session", { evil: true }))).status).toBe(400);
    expect((await app.request(post("/api/session", { reconnectOf: "nope" }))).status).toBe(400);
  });

  it("rejects oversized bodies", async () => {
    const { app } = make();
    const res = await app.request(post("/api/session", { turnstileToken: "x".repeat(20_000) }));
    expect(res.status).toBe(413);
  });

  it("blocks when the bot check fails, before minting a key", async () => {
    const openai = fakeOpenAI();
    const { app } = make(openai, {}, { verifyTurnstile: async () => false });
    const res = await app.request(post("/api/session", { turnstileToken: "t" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: "bot_check_failed" });
    expect(openai.calls).not.toContain("createClientSecret");
  });

  it("passes the turnstile token through to the verifier", async () => {
    let got: string | undefined;
    const { app } = make(
      fakeOpenAI(),
      {},
      {
        verifyTurnstile: async (token) => {
          got = token;
          return true;
        },
      },
    );
    expect((await app.request(post("/api/session", { turnstileToken: "tok" }))).status).toBe(200);
    expect(got).toBe("tok");
  });

  it("surfaces limit refusals with their codes", async () => {
    const { app, limits } = make();
    limits.tryStart = () => ({ ok: false, code: "demo_busy" });
    const busy = await app.request(post("/api/session", {}));
    expect([busy.status, await busy.json()]).toEqual([503, { code: "demo_busy" }]);
    limits.tryStart = () => ({ ok: false, code: "quota_reached" });
    const quota = await app.request(post("/api/session", {}));
    expect([quota.status, await quota.json()]).toEqual([429, { code: "quota_reached" }]);
  });

  it("frees the slot when minting fails", async () => {
    const { app, limits } = make(fakeOpenAI({ createClientSecret: failingWith(500) }));
    const ended: string[] = [];
    const end = limits.end.bind(limits);
    limits.end = (id) => (ended.push(id), end(id));
    await app.request(post("/api/session", {}));
    expect(ended).toHaveLength(1);
  });

  it("never logs the client secret, the api key or the client address", async () => {
    const { app, lines } = make();
    await app.request(post("/api/session", {}, { "x-forwarded-for": "203.0.113.9" }));
    await app.request(post("/api/session", { evil: true }));
    const log = lines.join("\n");
    expect(log).toContain("session_started");
    for (const s of [FAKE_CLIENT_SECRET, FAKE_API_KEY, "203.0.113.9"]) expect(log).not.toContain(s);
  });
});

describe("POST /api/session/:id/call and /end", () => {
  it("accepts a call report for a live session and rejects unknown ones", async () => {
    const { app } = make();
    const { sessionId } = (await (await app.request(post("/api/session", {}))).json()) as {
      sessionId: string;
    };
    expect(
      (await app.request(post(`/api/session/${sessionId}/call`, { callId: "rtc_1" }))).status,
    ).toBe(204);
    expect((await app.request(post("/api/session/nope/call", { callId: "rtc_1" }))).status).toBe(
      400,
    );
    expect((await app.request(post(`/api/session/${sessionId}/call`, {}))).status).toBe(400);
  });

  it("ends a session and is idempotent", async () => {
    const { app } = make();
    const { sessionId } = (await (await app.request(post("/api/session", {}))).json()) as {
      sessionId: string;
    };
    expect((await app.request(post(`/api/session/${sessionId}/end`, {}))).status).toBe(204);
    expect((await app.request(post(`/api/session/${sessionId}/end`, {}))).status).toBe(204);
    expect(
      (await app.request(post(`/api/session/${sessionId}/call`, { callId: "rtc_1" }))).status,
    ).toBe(400);
  });
});

describe("POST /api/chat", () => {
  const ask = (body: unknown) => post("/api/chat", body);
  const valid = { question: "What are the side effects?", slideId: "mechanism", history: [] };

  it("returns the validated answer", async () => {
    const res = await make().app.request(ask(valid));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ answer: "GLP-1 is a gut hormone." });
  });

  it("sends the shared prompt, the history in original roles and the question last", async () => {
    const openai = fakeOpenAI();
    await make(openai, { OPENAI_CHAT_MODEL: "chat-test" }).app.request(
      ask({
        ...valid,
        history: [
          { q: "Q1", a: "A1" },
          { q: "Q2", a: "A2" },
        ],
      }),
    );
    expect(openai.lastChat).toMatchObject({
      model: "chat-test",
      system: expect.stringContaining('The listener is on slide "mechanism"'),
      messages: [
        { role: "user", content: "Q1" },
        { role: "assistant", content: "A1" },
        { role: "user", content: "Q2" },
        { role: "assistant", content: "A2" },
        { role: "user", content: "What are the side effects?" },
      ],
      schema: { required: ["answer", "goto_slide", "resume"], additionalProperties: false },
    });
  });

  it("builds the prompt for the chosen presenter", async () => {
    const openai = fakeOpenAI();
    await make(openai).app.request(ask({ ...valid, persona: "mira" }));
    expect(openai.lastChat).toMatchObject({
      system: chatSystemPrompt("mechanism", "mira"),
    });
    expect(openai.lastChat).toMatchObject({ system: expect.stringMatching(/^You are Mira,/) });
  });

  it("drops nulls from strict-mode output and keeps navigation", async () => {
    const openai = fakeOpenAI({
      chatJson: async () => ({
        answer: "On the safety slide.",
        goto_slide: { slide_id: "safety", intent: "answer" },
        resume: null,
      }),
    });
    const res = await make(openai).app.request(ask(valid));
    expect(await res.json()).toEqual({
      answer: "On the safety slide.",
      goto_slide: { slide_id: "safety", intent: "answer" },
    });
  });

  it.each([
    ["an empty answer", { answer: "", resume: "yes" }],
    ["an unknown slide", { answer: "x", goto_slide: { slide_id: "nope", intent: "answer" } }],
    [
      "resume with an explicit navigation",
      { answer: "x", resume: true, goto_slide: { slide_id: "intro", intent: "user_request" } },
    ],
    ["a non-object", "just text"],
  ])("returns 502 for model output with %s", async (_, output) => {
    const { app } = make(fakeOpenAI({ chatJson: async () => output }));
    const res = await app.request(ask(valid));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ code: "server_error" });
  });

  it("rejects invalid requests", async () => {
    const { app } = make();
    const seven = Array.from({ length: 7 }, () => ({ q: "q", a: "a" }));
    for (const body of [
      {},
      { ...valid, question: "" },
      { ...valid, slideId: "nope" },
      { ...valid, history: seven },
      { ...valid, extra: 1 },
    ]) {
      expect((await app.request(ask(body))).status).toBe(400);
    }
  });

  it("maps upstream failures and missing configuration", async () => {
    const down = make(fakeOpenAI({ chatJson: failingWith(500) })).app;
    expect((await down.request(ask(valid))).status).toBe(502);
    const quota = make(fakeOpenAI({ chatJson: failingWith(429, "insufficient_quota") })).app;
    expect(await (await quota.request(ask(valid))).json()).toEqual({ code: "quota" });
    const none = make(null).app;
    expect((await none.request(ask(valid))).status).toBe(503);
  });
});

describe("rate limiting and routing", () => {
  it("limits POST routes per client and leaves GET routes alone", async () => {
    const { app } = make(fakeOpenAI(), { RATE_LIMIT_PER_MIN: "3" });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await app.request(post("/api/session", {}))).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    for (let i = 0; i < 5; i++) expect((await app.request("/api/health")).status).toBe(200);
  });

  it("rate-limits the shared POST budget across routes and logs only a hashed address", async () => {
    const { app, lines } = make(fakeOpenAI(), { RATE_LIMIT_PER_MIN: "1" });
    await app.request(post("/api/session", {}, { "x-forwarded-for": "203.0.113.9" }));
    const res = await app.request(post("/api/chat", {}, { "x-forwarded-for": "203.0.113.9" }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ code: "rate_limited" });
    expect(lines.join("\n")).not.toContain("203.0.113.9");
  });

  it("returns JSON 404 for unknown API paths", async () => {
    const { app } = make();
    const res = await app.request("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: "not_found" });
  });

  it("turns unexpected errors into a generic JSON 500 without leaking details", async () => {
    const limits = createLocalLimits(loadConfig({}));
    limits.status = () => {
      throw new Error("failure mentioning sk-abcdefghijklmnop");
    };
    const { app, lines } = make(fakeOpenAI(), {}, { limits });
    const res = await app.request("/api/health");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: "server_error" });
    const log = lines.join("\n");
    expect(log).toContain("unhandled_error");
    expect(log).not.toContain("sk-abcdefghijklmnop");
  });
});
