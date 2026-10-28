import { z } from "zod";
import { ChatResponse, Health, SessionResponse, type MetricsReport } from "@ava/shared";

type MetricsReportBody = z.infer<typeof MetricsReport>;

/** Stable codes the server returns (server/src/errors.ts), plus client-side transport failures. */
export type ApiCode =
  | "not_configured"
  | "quota"
  | "demo_paused"
  | "rate_limited"
  | "session_failed"
  | "demo_busy"
  | "quota_reached"
  | "bot_check_failed"
  | "bad_request"
  | "server_error"
  | "not_found"
  | "backend_unreachable";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; code: ApiCode };

const ErrorBody = z.object({ code: z.string() });
const KNOWN = new Set<string>([
  "not_configured",
  "quota",
  "demo_paused",
  "rate_limited",
  "session_failed",
  "demo_busy",
  "quota_reached",
  "bot_check_failed",
  "bad_request",
  "server_error",
  "not_found",
]);

export type HealthInfo = z.infer<typeof Health>;
export type SessionInfo = z.infer<typeof SessionResponse>;
export type ChatAnswer = z.infer<typeof ChatResponse>;
export interface ChatInput {
  question: string;
  slideId: string;
  history: { q: string; a: string }[];
}

export interface ApiClientDeps {
  fetch?: typeof fetch;
  sendBeacon?: (url: string, body?: BodyInit) => boolean;
}

async function call<T>(
  doFetch: typeof fetch,
  url: string,
  schema: z.ZodType<T> | null,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await doFetch(url, init);
  } catch {
    return { ok: false, code: "backend_unreachable" };
  }
  if (!res.ok) {
    const body = ErrorBody.safeParse(await res.json().catch(() => null));
    const code = body.success && KNOWN.has(body.data.code) ? body.data.code : "server_error";
    return { ok: false, code: code as ApiCode };
  }
  if (!schema) return { ok: true, data: undefined as T };
  const parsed = schema.safeParse(await res.json().catch(() => null));
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, code: "server_error" };
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/**
 * Typed wrapper over the server routes (arch §3.1). Every response is parsed with the shared Zod
 * schema. The client secret returned by startSession is handed to the caller and never stored here.
 */
export function createApiClient(deps: ApiClientDeps = {}) {
  const doFetch: typeof fetch = deps.fetch ?? ((...a) => fetch(...a));
  const beacon =
    deps.sendBeacon ??
    ((url: string, body?: BodyInit) =>
      typeof navigator !== "undefined" && navigator.sendBeacon
        ? navigator.sendBeacon(url, body)
        : false);

  return {
    getHealth: () => call(doFetch, "/api/health", Health),
    startSession: (opts: { reconnectOf?: string; turnstileToken?: string } = {}) =>
      call(doFetch, "/api/session", SessionResponse, json(opts)),
    reportCall: (sessionId: string, callId: string) =>
      call(doFetch, `/api/session/${encodeURIComponent(sessionId)}/call`, null, json({ callId })),
    /** Fire-and-forget on End and pagehide: never waits for the network (arch §6.6). */
    endSession: (sessionId: string): void => {
      const url = `/api/session/${encodeURIComponent(sessionId)}/end`;
      if (!beacon(url)) void doFetch(url, { method: "POST", keepalive: true }).catch(() => {});
    },
    /** Numbers only (arch §7). Fire-and-forget; the server route is hosted-only (M11). */
    sendMetrics: (sessionId: string, metrics: MetricsReportBody["metrics"]): void => {
      if (Object.keys(metrics).length === 0) return;
      const body = new Blob([JSON.stringify({ sessionId, metrics })], { type: "application/json" });
      if (!beacon("/api/metrics", body)) {
        void doFetch("/api/metrics", { ...json({ sessionId, metrics }), keepalive: true }).catch(
          () => {},
        );
      }
    },
    chat: (input: ChatInput) => call(doFetch, "/api/chat", ChatResponse, json(input)),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
