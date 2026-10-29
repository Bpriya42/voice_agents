import { serve } from "@hono/node-server";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { createKeyStatus } from "./keystatus.js";
import { createLimits, createLocalLimits, hasHostedLimits } from "./limits.js";
import { createLogger } from "./logger.js";
import { createOpenAIClient } from "./openai.js";
import { mountSpa } from "./spa.js";
import { createTurnstileVerifier } from "./turnstile.js";

const KEY_RECHECK_MS = 10 * 60 * 1000;

const logger = createLogger();

let config: Config;
try {
  config = loadConfig();
} catch (e) {
  // loadConfig names the variables and never their values.
  logger.error("invalid_config", { error: e });
  process.exit(1);
}

const openai = config.OPENAI_API_KEY ? createOpenAIClient(config.OPENAI_API_KEY) : null;
const keyStatus = createKeyStatus(openai, config.OPENAI_REALTIME_MODEL);

// Expiry is swept lazily; hanging up here is the backstop when the sideband is off (arch §3.3).
const onExpire = (sessionId: string, callId?: string) => {
  logger.info("session_expired", { sessionId });
  if (openai && callId) void openai.hangup(callId).catch(() => {});
};
const hosted = hasHostedLimits(config);
const limits = hosted ? createLimits(config, onExpire) : createLocalLimits(config);
const verifyTurnstile = config.TURNSTILE_SECRET_KEY
  ? createTurnstileVerifier(config.TURNSTILE_SECRET_KEY)
  : undefined;

const app = createApp({
  config,
  logger,
  openai,
  limits,
  keyStatus,
  ...(verifyTurnstile ? { verifyTurnstile } : {}),
});

// Production: this process also serves the built web app. Dev uses Vite instead.
const distDir = fileURLToPath(new URL("../../web/dist", import.meta.url));
const servingSpa = mountSpa(app, distDir);

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info("server_listening", {
    port: info.port,
    configured: Boolean(openai),
    servingSpa,
    sideband: config.SIDEBAND,
    hostedLimits: hosted,
    botGate: Boolean(verifyTurnstile),
  });
  if (!openai) logger.warn("not_configured", { hint: "Set OPENAI_API_KEY in .env (see README)." });
});

void keyStatus.refresh();
const timer = setInterval(() => void keyStatus.refresh(), KEY_RECHECK_MS);
timer.unref();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(timer);
    server.close(() => process.exit(0));
  });
}
