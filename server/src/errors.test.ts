import { describe, expect, it } from "vitest";
import { mapOpenAIError } from "./errors.js";
import { OpenAIError } from "./openai.js";

describe("mapOpenAIError", () => {
  it.each([
    [401, undefined, false, 503, "not_configured"],
    [403, undefined, false, 503, "not_configured"],
    [429, "insufficient_quota", false, 503, "quota"],
    [429, "insufficient_quota", true, 503, "demo_paused"],
    [429, "rate_limit_exceeded", false, 429, "rate_limited"],
    [429, undefined, true, 429, "rate_limited"],
    [500, undefined, false, 502, "session_failed"],
    [502, "bad_response", false, 502, "session_failed"],
    [404, "model_not_found", false, 502, "session_failed"],
  ])("OpenAI %s %s (hosted: %s) -> %s %s", (upstream, code, hosted, status, expected) => {
    expect(mapOpenAIError(new OpenAIError(upstream, code), hosted)).toEqual({
      status,
      code: expected,
    });
  });

  it("maps non-OpenAI failures (network, timeout) to session_failed", () => {
    expect(mapOpenAIError(new TypeError("fetch failed"), false)).toEqual({
      status: 502,
      code: "session_failed",
    });
    expect(mapOpenAIError("weird", true)).toEqual({ status: 502, code: "session_failed" });
  });
});
