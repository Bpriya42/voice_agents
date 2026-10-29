import { z } from "zod";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5_000;
const Result = z.object({ success: z.boolean() });

/**
 * The hosted bot gate (arch §3.6 layer 5). Only `success: true` passes; a missing token, a
 * network failure or an unexpected body all fail closed. The secret goes to Cloudflare only.
 */
export function createTurnstileVerifier(secret: string, fetchImpl: typeof fetch = fetch) {
  return async (token: string | undefined, ip: string): Promise<boolean> => {
    if (!token) return false;
    const form = new URLSearchParams({ secret, response: token });
    if (ip !== "unknown") form.set("remoteip", ip);
    try {
      const res = await fetchImpl(SITEVERIFY_URL, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return false;
      const body = Result.safeParse(await res.json().catch(() => null));
      return body.success && body.data.success;
    } catch {
      return false;
    }
  };
}
