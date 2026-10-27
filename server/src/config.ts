import { z } from "zod";

// An empty string in .env means "unset": it must not override a default or become 0.
const blankToUndefined = (v: unknown) => (v === "" ? undefined : v);
const optStr = z.preprocess(blankToUndefined, z.string().optional());
const optInt = z.preprocess(
  (v) => (v === "" || v === undefined ? undefined : Number(v)),
  z.number().int().positive().optional(),
);
const strWithDefault = (d: string) => z.preprocess(blankToUndefined, z.string().default(d));
const intWithDefault = (d: number) =>
  z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : Number(v)),
    z.number().int().positive().default(d),
  );
const flag = z.preprocess(blankToUndefined, z.enum(["0", "1"]).default("0"));

/** The value `.env.example` ships with. Treated as "no key", so the landing screen explains it. */
const KEY_PLACEHOLDER = "replace-with-your-key";

const EnvSchema = z.object({
  OPENAI_API_KEY: optStr,
  OPENAI_REALTIME_MODEL: strWithDefault("gpt-realtime-2.1"),
  OPENAI_REALTIME_VOICE: strWithDefault("marin"),
  OPENAI_CHAT_MODEL: strWithDefault("gpt-4.1-mini"),
  PORT: intWithDefault(8787),
  RATE_LIMIT_PER_MIN: intWithDefault(10),
  SESSION_MAX_MINUTES: optInt,
  MAX_CONCURRENT_SESSIONS: optInt,
  DAILY_SESSIONS_PER_IP: optInt,
  DAILY_SESSIONS_GLOBAL: optInt,
  SIDEBAND: flag.transform((v) => v === "1"),
  TRUST_PROXY: flag.transform((v) => v === "1"),
  TURNSTILE_SITE_KEY: optStr,
  TURNSTILE_SECRET_KEY: optStr,
  PUBLIC_REPO_URL: optStr,
  STATS_TOKEN: optStr,
});

export type Config = Omit<z.infer<typeof EnvSchema>, "TRUST_PROXY"> & {
  /** Read X-Forwarded-For. On when TRUST_PROXY=1 or when running on Render or Railway. */
  trustProxy: boolean;
};

/**
 * Parses the environment once at boot. Errors name the variables, never their values.
 * The server boots without a key so the landing screen can say what is missing.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ");
    throw new Error(`Invalid configuration for: ${names}. See .env.example.`);
  }
  const { TRUST_PROXY, ...rest } = parsed.data;
  return {
    ...rest,
    OPENAI_API_KEY: rest.OPENAI_API_KEY === KEY_PLACEHOLDER ? undefined : rest.OPENAI_API_KEY,
    trustProxy: TRUST_PROXY || Boolean(env["RENDER"]) || Boolean(env["RAILWAY_ENVIRONMENT"]),
  };
}
