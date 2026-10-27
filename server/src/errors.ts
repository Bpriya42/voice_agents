import { OpenAIError } from "./openai.js";

/** Stable codes the client UI relies on (arch §6.2). */
export type ApiErrorCode =
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
  | "not_found";

export function mapOpenAIError(
  e: unknown,
  hosted: boolean,
): { status: 429 | 502 | 503; code: ApiErrorCode } {
  if (!(e instanceof OpenAIError)) return { status: 502, code: "session_failed" };
  if (e.status === 401 || e.status === 403) return { status: 503, code: "not_configured" };
  if (e.status === 429 && e.code === "insufficient_quota") {
    return { status: 503, code: hosted ? "demo_paused" : "quota" };
  }
  if (e.status === 429) return { status: 429, code: "rate_limited" };
  return { status: 502, code: "session_failed" };
}
