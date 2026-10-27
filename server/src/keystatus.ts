import type { OpenAIClient } from "./openai.js";

const RETRY_UNKNOWN_MS = 30_000;

/**
 * Cached answer to "does the configured key work?" (arch §3.1). `false` means OpenAI rejected the
 * key (401); `null` means unknown (no key, or OpenAI unreachable), so an outage is not reported
 * as a bad key.
 */
export interface KeyStatus {
  get(): Promise<boolean | null>;
  /** Re-checks now. Called at boot and every 10 minutes by index.ts. */
  refresh(): Promise<void>;
}

export function createKeyStatus(
  openai: OpenAIClient | null,
  model: string,
  now: () => number = Date.now,
): KeyStatus {
  let value: boolean | null = null;
  let checkedAt: number | null = null;
  let inFlight: Promise<void> | null = null;

  const refresh = () => {
    if (!openai) return Promise.resolve();
    inFlight ??= openai
      .checkModel(model)
      .then((r) => {
        value = r === "ok" ? true : r === "unauthorized" ? false : null;
      })
      .catch(() => {
        value = null;
      })
      .finally(() => {
        checkedAt = now();
        inFlight = null;
      });
    return inFlight;
  };

  return {
    refresh,
    async get() {
      if (!openai) return null;
      const stale = checkedAt === null || (value === null && now() - checkedAt > RETRY_UNKNOWN_MS);
      if (stale) await refresh();
      return value;
    },
  };
}
