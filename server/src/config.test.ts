import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("applies defaults and boots without a key", () => {
    const c = loadConfig({});
    expect(c).toMatchObject({
      OPENAI_REALTIME_MODEL: "gpt-realtime-2.1",
      OPENAI_REALTIME_VOICE: "marin",
      OPENAI_CHAT_MODEL: "gpt-4.1-mini",
      PORT: 8787,
      RATE_LIMIT_PER_MIN: 10,
      SIDEBAND: false,
      trustProxy: false,
    });
    expect(c.OPENAI_API_KEY).toBeUndefined();
    expect(c.SESSION_MAX_MINUTES).toBeUndefined();
  });

  it("treats empty strings as unset, as .env.example ships them", () => {
    const c = loadConfig({
      PORT: "",
      OPENAI_REALTIME_MODEL: "",
      SESSION_MAX_MINUTES: "",
      MAX_CONCURRENT_SESSIONS: "",
      SIDEBAND: "",
      TURNSTILE_SITE_KEY: "",
      TRUST_PROXY: "",
    });
    expect(c).toMatchObject({
      PORT: 8787,
      OPENAI_REALTIME_MODEL: "gpt-realtime-2.1",
      SIDEBAND: false,
    });
    expect(c.SESSION_MAX_MINUTES).toBeUndefined();
    expect(c.TURNSTILE_SITE_KEY).toBeUndefined();
  });

  it("parses numbers, flags and the key", () => {
    const c = loadConfig({
      OPENAI_API_KEY: "test-key",
      PORT: "9000",
      SESSION_MAX_MINUTES: "10",
      MAX_CONCURRENT_SESSIONS: "5",
      SIDEBAND: "1",
    });
    expect(c).toMatchObject({
      OPENAI_API_KEY: "test-key",
      PORT: 9000,
      SESSION_MAX_MINUTES: 10,
      MAX_CONCURRENT_SESSIONS: 5,
      SIDEBAND: true,
    });
  });

  it("treats the .env.example placeholder as no key", () => {
    expect(loadConfig({ OPENAI_API_KEY: "replace-with-your-key" }).OPENAI_API_KEY).toBeUndefined();
  });

  it("trusts the proxy only when asked or on a known host", () => {
    expect(loadConfig({}).trustProxy).toBe(false);
    expect(loadConfig({ TRUST_PROXY: "1" }).trustProxy).toBe(true);
    expect(loadConfig({ RENDER: "true" }).trustProxy).toBe(true);
    expect(loadConfig({ RAILWAY_ENVIRONMENT: "production" }).trustProxy).toBe(true);
  });

  it("names the variable but never the value when invalid", () => {
    expect(() => loadConfig({ PORT: "not-a-port-secret-value" })).toThrowError(/PORT/);
    try {
      loadConfig({ PORT: "not-a-port-secret-value", SIDEBAND: "maybe-secret" });
      expect.unreachable();
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("PORT");
      expect(msg).toContain("SIDEBAND");
      expect(msg).not.toContain("secret");
    }
  });

  it.each(["0", "-5", "1.5"])("rejects a non-positive or fractional limit %s", (v) => {
    expect(() => loadConfig({ RATE_LIMIT_PER_MIN: v })).toThrowError(/RATE_LIMIT_PER_MIN/);
    expect(() => loadConfig({ DAILY_SESSIONS_GLOBAL: v })).toThrowError(/DAILY_SESSIONS_GLOBAL/);
  });
});
