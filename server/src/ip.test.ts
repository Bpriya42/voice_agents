import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { clientIp, hashIp } from "./ip.js";

async function ipFor(headers: Record<string, string>, trustProxy: boolean) {
  const app = new Hono();
  app.get("/", (c) => c.text(clientIp(c, trustProxy)));
  return (await app.request("/", { headers })).text();
}

describe("clientIp", () => {
  it("uses the first forwarded hop only when the proxy is trusted", async () => {
    const h = { "x-forwarded-for": "203.0.113.9, 10.0.0.1" };
    expect(await ipFor(h, true)).toBe("203.0.113.9");
    expect(await ipFor(h, false)).toBe("unknown");
  });

  it("ignores values that are not IP addresses", async () => {
    expect(await ipFor({ "x-forwarded-for": "not-an-ip" }, true)).toBe("unknown");
    expect(await ipFor({ "x-forwarded-for": "x".repeat(5000) }, true)).toBe("unknown");
  });

  it("accepts IPv6", async () => {
    expect(await ipFor({ "x-forwarded-for": "2001:db8::1" }, true)).toBe("2001:db8::1");
  });

  it("falls back to unknown when there is no socket", async () => {
    expect(await ipFor({}, true)).toBe("unknown");
  });
});

describe("hashIp", () => {
  it("is short, stable within a process, and does not contain the address", () => {
    const h = hashIp("203.0.113.9");
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(hashIp("203.0.113.9")).toBe(h);
    expect(hashIp("203.0.113.10")).not.toBe(h);
    expect(h).not.toContain("203");
  });
});
