import type { Config } from "./config.js";

export type StartResult =
  | { ok: true; sessionId: string; expiresAt: number | null }
  | { ok: false; code: "demo_busy" | "quota_reached" };

/**
 * Everything the hosted demo restricts (arch §3.6) behind one interface. M3 ships the local
 * implementation; M11 adds concurrency and quotas behind the same interface.
 */
export interface Limits {
  allowRequest(ip: string, now: number): boolean;
  tryStart(req: {
    ip: string;
    now: number;
    sessionId: string;
    reconnectOf?: string | undefined;
  }): StartResult;
  attachCall(sessionId: string, callId: string): boolean;
  end(sessionId: string): void;
  status(): { busy: boolean; paused: boolean };
}

const WINDOW_MS = 60_000;
const PRUNE_ABOVE = 1_000;

/** Local runs: only the per-minute request rate applies. Sessions always start, with no expiry. */
export function createLocalLimits(config: Pick<Config, "RATE_LIMIT_PER_MIN">): Limits {
  const windows = new Map<string, { start: number; count: number }>();
  const active = new Map<string, { callId?: string }>();

  return {
    allowRequest(ip, now) {
      if (windows.size > PRUNE_ABOVE) {
        for (const [k, w] of windows) if (now - w.start >= WINDOW_MS) windows.delete(k);
      }
      const w = windows.get(ip);
      if (!w || now - w.start >= WINDOW_MS) {
        windows.set(ip, { start: now, count: 1 });
        return true;
      }
      w.count += 1;
      return w.count <= config.RATE_LIMIT_PER_MIN;
    },
    tryStart({ sessionId }) {
      active.set(sessionId, {});
      return { ok: true, sessionId, expiresAt: null };
    },
    attachCall(sessionId, callId) {
      const s = active.get(sessionId);
      if (!s) return false;
      s.callId = callId;
      return true;
    },
    end(sessionId) {
      active.delete(sessionId);
    },
    status() {
      return { busy: false, paused: false };
    },
  };
}
