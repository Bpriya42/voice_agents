import type { Config } from "./config.js";
import { hashIp } from "./ip.js";

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
  /** The registered session, or undefined when it ended or expired. */
  session(sessionId: string): { expiresAt: number | null; callId?: string } | undefined;
  end(sessionId: string): void;
  /** OpenAI rejected a call for budget (`demo_paused`); the landing warns until it resets. */
  pause(now: number): void;
  status(now: number): { busy: boolean; paused: boolean };
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
    session(sessionId) {
      const s = active.get(sessionId);
      return s && { expiresAt: null, ...s };
    },
    end(sessionId) {
      active.delete(sessionId);
    },
    pause() {},
    status() {
      return { busy: false, paused: false };
    },
  };
}

export const PAUSE_MS = 10 * 60_000;

type HostedConfig = Pick<
  Config,
  | "RATE_LIMIT_PER_MIN"
  | "SESSION_MAX_MINUTES"
  | "MAX_CONCURRENT_SESSIONS"
  | "DAILY_SESSIONS_PER_IP"
  | "DAILY_SESSIONS_GLOBAL"
>;

/** True when any hosted limit is set, so index.ts picks createLimits over createLocalLimits. */
export const hasHostedLimits = (cfg: HostedConfig) =>
  Boolean(
    cfg.SESSION_MAX_MINUTES ||
    cfg.MAX_CONCURRENT_SESSIONS ||
    cfg.DAILY_SESSIONS_PER_IP ||
    cfg.DAILY_SESSIONS_GLOBAL,
  );

interface Active {
  ipHash: string;
  startedAt: number;
  expiresAt: number | null;
  callId?: string;
}

export type HostedLimits = Limits & {
  /** Test-only view of what is stored, to check that raw IPs never are. */
  inspect(): { activeIps: string[]; dailyIps: string[] };
};

/**
 * The hosted demo (arch §3.6): concurrency, daily per-IP and global quotas reset at 00:00 UTC, and
 * a session time limit. In memory (one instance), behind the same interface a Redis store could
 * implement. IPs are kept only as salted hashes.
 */
export function createLimits(
  cfg: HostedConfig,
  onExpire: (sessionId: string, callId?: string) => void = () => {},
): HostedLimits {
  const active = new Map<string, Active>();
  const perIpDay = new Map<string, number>();
  const rate = createLocalLimits(cfg);
  let day = "";
  let global = 0;
  let pausedUntil = 0;

  const rollDay = (now: number) => {
    const d = new Date(now).toISOString().slice(0, 10);
    if (d !== day) {
      day = d;
      global = 0;
      perIpDay.clear();
    }
  };
  // Sessions with no call_id reported still hold their slot until expiresAt (arch §3.3).
  const sweep = (now: number) => {
    for (const [id, a] of active) {
      if (a.expiresAt !== null && a.expiresAt <= now) {
        active.delete(id);
        onExpire(id, a.callId);
      }
    }
  };
  const busy = () =>
    Boolean(cfg.MAX_CONCURRENT_SESSIONS && active.size >= cfg.MAX_CONCURRENT_SESSIONS);

  return {
    allowRequest(ip, now) {
      return rate.allowRequest(hashIp(ip), now);
    },
    tryStart({ ip, now, sessionId, reconnectOf }): StartResult {
      rollDay(now);
      sweep(now);
      const prev = reconnectOf ? active.get(reconnectOf) : undefined;
      if (reconnectOf && prev) {
        // Take over the slot: keep expiresAt, no quota charge (arch §3.2).
        active.delete(reconnectOf);
        active.set(sessionId, { ipHash: prev.ipHash, startedAt: now, expiresAt: prev.expiresAt });
        return { ok: true, sessionId, expiresAt: prev.expiresAt };
      }
      if (busy()) return { ok: false, code: "demo_busy" };
      const k = hashIp(ip);
      if (cfg.DAILY_SESSIONS_GLOBAL && global >= cfg.DAILY_SESSIONS_GLOBAL) {
        return { ok: false, code: "quota_reached" };
      }
      if (cfg.DAILY_SESSIONS_PER_IP && (perIpDay.get(k) ?? 0) >= cfg.DAILY_SESSIONS_PER_IP) {
        return { ok: false, code: "quota_reached" };
      }
      global += 1;
      perIpDay.set(k, (perIpDay.get(k) ?? 0) + 1);
      const expiresAt = cfg.SESSION_MAX_MINUTES ? now + cfg.SESSION_MAX_MINUTES * 60_000 : null;
      active.set(sessionId, { ipHash: k, startedAt: now, expiresAt });
      return { ok: true, sessionId, expiresAt };
    },
    attachCall(sessionId, callId) {
      const a = active.get(sessionId);
      if (!a) return false;
      a.callId = callId;
      return true;
    },
    session(sessionId) {
      const a = active.get(sessionId);
      return a && { expiresAt: a.expiresAt, ...(a.callId ? { callId: a.callId } : {}) };
    },
    end(sessionId) {
      active.delete(sessionId);
    },
    pause(now) {
      pausedUntil = now + PAUSE_MS;
    },
    status(now) {
      sweep(now);
      return { busy: busy(), paused: now < pausedUntil };
    },
    inspect() {
      return {
        activeIps: [...active.values()].map((a) => a.ipHash),
        dailyIps: [...perIpDay.keys()],
      };
    },
  };
}
