import { describe, expect, it } from "vitest";
import { createLogger, redact } from "./logger.js";

const FAKE_KEY = "sk-test1234567890abcdefghijkl";
const FAKE_EK = "ek_test_abcdefghijklmnop";

function capture() {
  const lines: string[] = [];
  return { lines, logger: createLogger((l) => lines.push(l)) };
}

describe("logger redaction", () => {
  it("never writes keys or bearer tokens, in fields or in the message", () => {
    const { lines, logger } = capture();
    logger.info(`calling with ${FAKE_KEY}`, {
      apiKey: FAKE_KEY,
      note: "Bearer abc.def-ghi",
      other: `value ${FAKE_EK}`,
    });
    const out = lines.join("\n");
    for (const s of [FAKE_KEY, FAKE_EK, "abc.def-ghi"]) expect(out).not.toContain(s);
    expect(out).toContain("[redacted]");
  });

  it("redacts sensitive field names whatever their value", () => {
    const out = redact({
      clientSecret: "x",
      Authorization: "y",
      sdp: "v=0",
      transcript: "patient said",
      password: "p",
      ip: "203.0.113.9",
      sessionId: "keep-me",
      code: "quota",
    });
    expect(out).toEqual({
      clientSecret: "[redacted]",
      Authorization: "[redacted]",
      sdp: "[redacted]",
      transcript: "[redacted]",
      password: "[redacted]",
      ip: "[redacted]",
      sessionId: "keep-me",
      code: "quota",
    });
  });

  it("redacts nested objects and arrays", () => {
    const { lines, logger } = capture();
    logger.warn("nested", {
      a: { b: [{ token: "t", text: `x ${FAKE_KEY}` }, FAKE_EK] },
    });
    const out = lines.join("\n");
    expect(out).not.toContain(FAKE_KEY);
    expect(out).not.toContain(FAKE_EK);
    expect(JSON.parse(out).a.b[0].token).toBe("[redacted]");
  });

  it("logs errors by name and redacted message, not as raw objects", () => {
    const { lines, logger } = capture();
    logger.error("failed", { error: new Error(`bad key ${FAKE_KEY}`) });
    const out = JSON.parse(lines[0]!);
    expect(out.error).toBe("Error: bad key [redacted]");
  });

  it("stops at a maximum depth", () => {
    let deep: unknown = "leaf";
    for (let i = 0; i < 10; i++) deep = { n: deep };
    expect(JSON.stringify(redact(deep))).toContain("[depth]");
  });

  it("emits one JSON line with level, time and message that fields cannot overwrite", () => {
    const { lines, logger } = capture();
    logger.error("real", { msg: "spoofed", level: "info", t: "never" });
    const out = JSON.parse(lines[0]!);
    expect(out).toMatchObject({ level: "error", msg: "real" });
    expect(out.t).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(lines).toHaveLength(1);
  });
});
