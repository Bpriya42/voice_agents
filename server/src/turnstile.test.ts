import { describe, expect, it } from "vitest";
import { createTurnstileVerifier } from "./turnstile.js";

const SECRET = "turnstile-secret-not-real";

function fakeFetch(respond: () => Response | Promise<Response>) {
  const seen: { url: string; body: URLSearchParams }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, body: init.body as URLSearchParams });
    return respond();
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("createTurnstileVerifier", () => {
  it("posts the secret, token and IP to siteverify and accepts success: true", async () => {
    const { fetchImpl, seen } = fakeFetch(() => json({ success: true }));
    expect(await createTurnstileVerifier(SECRET, fetchImpl)("tok", "203.0.113.9")).toBe(true);
    expect(seen[0]!.url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(Object.fromEntries(seen[0]!.body)).toEqual({
      secret: SECRET,
      response: "tok",
      remoteip: "203.0.113.9",
    });
  });

  it("omits an unknown IP", async () => {
    const { fetchImpl, seen } = fakeFetch(() => json({ success: true }));
    await createTurnstileVerifier(SECRET, fetchImpl)("tok", "unknown");
    expect(seen[0]!.body.has("remoteip")).toBe(false);
  });

  it.each([
    ["success: false", () => json({ success: false })],
    ["a non-boolean success", () => json({ success: "true" })],
    ["an HTTP error", () => json({ success: true }, 500)],
    ["a non-JSON body", () => new Response("oops")],
    [
      "a network failure",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("fails closed on %s", async (_, respond) => {
    const { fetchImpl } = fakeFetch(respond);
    expect(await createTurnstileVerifier(SECRET, fetchImpl)("tok", "1.2.3.4")).toBe(false);
  });

  it("rejects a missing token without calling Cloudflare", async () => {
    const { fetchImpl, seen } = fakeFetch(() => json({ success: true }));
    expect(await createTurnstileVerifier(SECRET, fetchImpl)(undefined, "1.2.3.4")).toBe(false);
    expect(seen).toHaveLength(0);
  });
});
