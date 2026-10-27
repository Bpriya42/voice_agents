import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";

// A per-process salt, so a logged hash can't be reversed by hashing every IPv4 address.
const SALT = randomBytes(16);

/**
 * The caller's address, used for limits only. Behind a trusted proxy (Render, Railway) it is the
 * first X-Forwarded-For hop; otherwise the socket address. Anything that isn't an IP is ignored.
 * Note: the first hop is client-supplied if the platform appends rather than overwrites, so a
 * determined caller can dodge per-IP limits; the global caps and the project budget still hold.
 */
export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const first = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (first && isIP(first)) return first;
  }
  try {
    const addr = getConnInfo(c).remote.address;
    if (addr && isIP(addr)) return addr;
  } catch {
    // No socket (for example in app.request() tests).
  }
  return "unknown";
}

/** A short, salted hash for log lines. Full addresses are never logged. */
export function hashIp(ip: string): string {
  return createHash("sha256").update(SALT).update(ip).digest("hex").slice(0, 8);
}
