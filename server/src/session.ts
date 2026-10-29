import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import {
  CallReport,
  DEFAULT_PERSONA,
  SessionRequest,
  TOOLS,
  personaById,
  sessionConfig,
  sessionInstructions,
} from "@ava/shared";
import type { Deps } from "./app.js";
import { mapOpenAIError } from "./errors.js";
import { clientIp } from "./ip.js";
import { openSideband as defaultOpenSideband } from "./sideband.js";
import type { Stats } from "./stats.js";

const TOOL_NAMES = TOOLS.map((t) => t.name);

export function sessionRoutes(deps: Deps, stats: Stats) {
  const r = new Hono();
  const hosted = Boolean(deps.config.SESSION_MAX_MINUTES);
  const now = () => deps.now?.() ?? Date.now();
  const openSideband = deps.openSideband ?? defaultOpenSideband;
  /** Open sidebands by sessionId, so End and reconnect can close the old one (arch §3.2). */
  const sidebands = new Map<string, { close: () => void }>();
  const closeSideband = (sessionId: string) => {
    sidebands.get(sessionId)?.close();
    sidebands.delete(sessionId);
  };

  r.post("/", async (c) => {
    const openai = deps.openai;
    if (!openai) return c.json({ code: "not_configured" }, 503);

    const parsed = SessionRequest.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ code: "bad_request" }, 400);
    const ip = clientIp(c, deps.config.trustProxy);

    if (deps.verifyTurnstile && !(await deps.verifyTurnstile(parsed.data.turnstileToken, ip))) {
      stats.count("bot_check_failed");
      return c.json({ code: "bot_check_failed" }, 403);
    }

    const reconnectOf = parsed.data.reconnectOf;
    const slot = deps.limits.tryStart({
      ip,
      now: now(),
      reconnectOf,
      sessionId: randomUUID(),
      persona: parsed.data.persona,
    });
    if (!slot.ok) {
      stats.count(slot.code);
      return c.json({ code: slot.code }, slot.code === "demo_busy" ? 503 : 429);
    }
    if (reconnectOf) closeSideband(reconnectOf);
    // The slot's presenter: the requested one, or the original on a reconnect (arch §3.4).
    const { persona } = slot;
    const voice =
      persona === DEFAULT_PERSONA ? deps.config.OPENAI_REALTIME_VOICE : personaById(persona).voice;

    try {
      const secret = await openai.createClientSecret(
        sessionConfig({ model: deps.config.OPENAI_REALTIME_MODEL, voice, persona }),
        60,
      );
      stats.count(reconnectOf ? "session_reconnected" : "session_started");
      deps.logger.info("session_started", {
        sessionId: slot.sessionId,
        reconnect: Boolean(reconnectOf),
        persona,
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
      if (code === "demo_paused") deps.limits.pause(now());
      stats.count(code);
      deps.logger.warn("session_failed", { code });
      return c.json({ code }, status);
    }
  });

  // The browser reports the OpenAI call_id so the hosted build can open the sideband (arch §3.3).
  r.post("/:id/call", async (c) => {
    const sessionId = c.req.param("id");
    const body = CallReport.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success || !deps.limits.attachCall(sessionId, body.data.callId)) {
      return c.json({ code: "bad_request" }, 400);
    }
    const { openai } = deps;
    const apiKey = deps.config.OPENAI_API_KEY;
    if (deps.config.SIDEBAND && openai && apiKey) {
      const callId = body.data.callId;
      const persona = deps.limits.session(sessionId)?.persona ?? DEFAULT_PERSONA;
      const instructions = sessionInstructions(persona);
      closeSideband(sessionId);
      const sideband = openSideband({
        apiKey,
        callId,
        expiresAt: deps.limits.session(sessionId)?.expiresAt ?? null,
        expectedInstructions: instructions,
        expectedTools: TOOL_NAMES,
        reapply: (send) =>
          send({
            type: "session.update",
            session: { type: "realtime", instructions, tools: TOOLS },
          }),
        onFlag: (flag) => stats.count(`flag_${flag}`),
        hangup: () => openai.hangup(callId),
        onClose: () => {
          if (sidebands.get(sessionId) === sideband) sidebands.delete(sessionId);
        },
        logger: deps.logger,
      });
      sidebands.set(sessionId, sideband);
    }
    return c.body(null, 204);
  });

  r.post("/:id/end", (c) => {
    const sessionId = c.req.param("id");
    closeSideband(sessionId);
    deps.limits.end(sessionId);
    return c.body(null, 204);
  });

  return r;
}
