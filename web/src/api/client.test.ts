import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client.js";

const health = {
  configured: true,
  keyValid: true,
  limits: { sessionMaxMinutes: null, busy: false, paused: false },
  public: {},
};
const res = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("api client", () => {
  it("parses health with the shared schema", async () => {
    const api = createApiClient({
      fetch: vi.fn(async () => res(200, health)) as unknown as typeof fetch,
    });
    await expect(api.getHealth()).resolves.toEqual({ ok: true, data: health });
  });

  it("maps non-2xx responses to the server's stable code", async () => {
    const api = createApiClient({
      fetch: vi.fn(async () => res(503, { code: "demo_busy" })) as unknown as typeof fetch,
    });
    await expect(api.startSession()).resolves.toEqual({ ok: false, code: "demo_busy" });
  });

  it("unknown codes and malformed bodies become server_error", async () => {
    const api = createApiClient({
      fetch: vi.fn(async () => res(500, { code: "weird" })) as unknown as typeof fetch,
    });
    await expect(api.startSession()).resolves.toEqual({ ok: false, code: "server_error" });
    const bad = createApiClient({
      fetch: vi.fn(async () => res(200, { nope: 1 })) as unknown as typeof fetch,
    });
    await expect(bad.getHealth()).resolves.toEqual({ ok: false, code: "server_error" });
  });

  it("a network failure is backend_unreachable", async () => {
    const api = createApiClient({
      fetch: vi.fn(async () => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch,
    });
    await expect(api.getHealth()).resolves.toEqual({ ok: false, code: "backend_unreachable" });
  });

  it("posts session, call and chat bodies as JSON", async () => {
    const f = vi.fn(async (...[url]: [string, RequestInit?]) =>
      url === "/api/session"
        ? res(200, {
            clientSecret: "x",
            sessionId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
            expiresAt: null,
          })
        : url.endsWith("/call")
          ? new Response(null, { status: 204 })
          : res(200, { answer: "Hi." }),
    );
    const api = createApiClient({ fetch: f as unknown as typeof fetch });
    expect((await api.startSession({ reconnectOf: "abc", persona: "mira" })).ok).toBe(true);
    expect(f.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ reconnectOf: "abc", persona: "mira" }),
    });
    await expect(api.reportCall("s 1", "call_1")).resolves.toEqual({ ok: true, data: undefined });
    expect(f.mock.calls[1]![0]).toBe("/api/session/s%201/call");
    await expect(api.chat({ question: "q", slideId: "intro", history: [] })).resolves.toEqual({
      ok: true,
      data: { answer: "Hi." },
    });
  });

  it("endSession uses sendBeacon, falling back to a keepalive fetch", () => {
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    const beacon = vi.fn(() => true);
    createApiClient({ fetch: f as unknown as typeof fetch, sendBeacon: beacon }).endSession("s1");
    expect(beacon).toHaveBeenCalledWith("/api/session/s1/end");
    expect(f).not.toHaveBeenCalled();
    createApiClient({ fetch: f as unknown as typeof fetch, sendBeacon: () => false }).endSession(
      "s1",
    );
    expect(f).toHaveBeenCalledWith("/api/session/s1/end", { method: "POST", keepalive: true });
  });
});
