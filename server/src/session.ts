import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { CallReport, SessionRequest, sessionConfig } from "@ava/shared";
import type { Deps } from "./app.js";
import { mapOpenAIError } from "./errors.js";
import { clientIp } from "./ip.js";

export function sessionRoutes(deps: Deps) {
  const r = new Hono();
  const hosted = Boolean(deps.config.SESSION_MAX_MINUTES);

  r.post("/", async (c) => {
    const openai = deps.openai;
    if (!openai) return c.json({ code: "not_configured" }, 503);

    const parsed = SessionRequest.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ code: "bad_request" }, 400);
    const ip = clientIp(c, deps.config.trustProxy);

    if (deps.verifyTurnstile && !(await deps.verifyTurnstile(parsed.data.turnstileToken, ip))) {
      return c.json({ code: "bot_check_failed" }, 403);
    }

    const slot = deps.limits.tryStart({
      ip,
      now: deps.now?.() ?? Date.now(),
      reconnectOf: parsed.data.reconnectOf,
      sessionId: randomUUID(),
    });
    if (!slot.ok) return c.json({ code: slot.code }, slot.code === "demo_busy" ? 503 : 429);

    try {
      const secret = await openai.createClientSecret(
        sessionConfig({
          model: deps.config.OPENAI_REALTIME_MODEL,
          voice: deps.config.OPENAI_REALTIME_VOICE,
        }),
        60,
      );
      deps.logger.info("session_started", {
        sessionId: slot.sessionId,
        reconnect: Boolean(parsed.data.reconnectOf),
      });
      // The response body is the only place the client secret appears.
      return c.json({
        clientSecret: secret.value,
        sessionId: slot.sessionId,
        expiresAt: slot.expiresAt,
      });
    } catch (e) {
      deps.limits.end(slot.sessionId);
      const { status, code } = mapOpenAIError(e, hosted);
      deps.logger.warn("session_failed", { code });
      return c.json({ code }, status);
    }
  });

  // The browser reports the OpenAI call_id so the hosted build can open the sideband (M11).
  r.post("/:id/call", async (c) => {
    const body = CallReport.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success || !deps.limits.attachCall(c.req.param("id"), body.data.callId)) {
      return c.json({ code: "bad_request" }, 400);
    }
    return c.body(null, 204);
  });

  r.post("/:id/end", (c) => {
    deps.limits.end(c.req.param("id"));
    return c.body(null, 204);
  });

  return r;
}
