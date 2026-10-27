// Keys whose values are never logged. "ip$" catches a raw `ip` field; log `ipHash` instead (ip.ts).
const SENSITIVE_KEY =
  /key|secret|token|authorization|cookie|password|sdp|transcript|clientSecret|ip$/i;
const SECRET_VALUE = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /\bek_[A-Za-z0-9_-]{8,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
];
const MAX_DEPTH = 6;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[depth]";
  if (typeof value === "string") {
    return SECRET_VALUE.reduce((s, re) => s.replace(re, "[redacted]"), value);
  }
  if (value instanceof Error) return redact(`${value.name}: ${value.message}`, depth + 1);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        SENSITIVE_KEY.test(k) ? "[redacted]" : redact(v, depth + 1),
      ]),
    );
  }
  return value;
}

type Level = "info" | "warn" | "error";
export type Logger = Record<Level, (msg: string, fields?: Record<string, unknown>) => void>;

/** The one place server code writes logs. Structured JSON, redacted before it is serialised. */
export function createLogger(
  write: (line: string) => void = (l) => process.stdout.write(l + "\n"),
): Logger {
  const log =
    (level: Level) =>
    (msg: string, fields: Record<string, unknown> = {}) =>
      // Caller fields go first so they can never overwrite the envelope.
      write(
        JSON.stringify({
          ...(redact(fields) as object),
          t: new Date().toISOString(),
          level,
          msg: redact(msg),
        }),
      );
  return { info: log("info"), warn: log("warn"), error: log("error") };
}
