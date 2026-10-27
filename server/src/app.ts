import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { Health } from "@ava/shared";
import type { Config } from "./config.js";
import type { Logger } from "./logger.js";
import type { OpenAIClient } from "./openai.js";
import type { Limits } from "./limits.js";
import { createKeyStatus, type KeyStatus } from "./keystatus.js";
import { sessionRoutes } from "./session.js";
import { chatRoute } from "./chat.js";
import { clientIp, hashIp } from "./ip.js";

export interface Deps {
  config: Config;
  logger: Logger;
  /** null when no key is configured. */
  openai: OpenAIClient | null;
  limits: Limits;
  keyStatus?: KeyStatus;
  now?: () => number;
  /** Hosted bot gate (M11). When set, /api/session requires it to pass. */
  verifyTurnstile?: (token: string | undefined, ip: string) => Promise<boolean>;
}

const MAX_BODY_BYTES = 16 * 1024;

/**
 * Builds the API from injected dependencies, so tests construct it with fakes. There is no CORS
 * middleware on purpose: the browser only calls this same-origin (Vite proxies /api in dev).
 */
export function createApp(deps: Deps) {
  const app = new Hono();
  const now = () => deps.now?.() ?? Date.now();
  const keyStatus =
    deps.keyStatus ?? createKeyStatus(deps.openai, deps.config.OPENAI_REALTIME_MODEL, now);

  app.use("*", secureHeaders());
  app.use(
    "/api/*",
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ code: "bad_request" }, 413) }),
  );
  app.use("/api/*", async (c, next) => {
    if (c.req.method !== "POST") return next();
    const ip = clientIp(c, deps.config.trustProxy);
    if (!deps.limits.allowRequest(ip, now())) {
      deps.logger.warn("rate_limited", { ipHash: hashIp(ip), path: c.req.path });
      return c.json({ code: "rate_limited" }, 429);
    }
    return next();
  });

  app.get("/api/health", async (c) => {
    const keyValid = await keyStatus.get();
    const body = Health.parse({
      configured: Boolean(deps.openai),
      keyValid,
      limits: {
        sessionMaxMinutes: deps.config.SESSION_MAX_MINUTES ?? null,
        ...deps.limits.status(),
      },
      // The only config values the browser may see; no VITE_* config variable exists.
      public: {
        ...(deps.config.TURNSTILE_SITE_KEY
          ? { turnstileSiteKey: deps.config.TURNSTILE_SITE_KEY }
          : {}),
        ...(deps.config.PUBLIC_REPO_URL ? { repoUrl: deps.config.PUBLIC_REPO_URL } : {}),
      },
    });
    return c.json(body);
  });

  app.route("/api/session", sessionRoutes(deps));
  app.post("/api/chat", chatRoute(deps));

  // Unknown API paths must stay JSON and never fall through to the SPA.
  app.all("/api/*", (c) => c.json({ code: "not_found" }, 404));

  app.onError((err, c) => {
    deps.logger.error("unhandled_error", { error: err });
    return c.json({ code: "server_error" }, 500);
  });

  return app;
}
