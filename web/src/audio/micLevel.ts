export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / samples.length);
}

/** Speech = level above threshold for at least holdMs (arch §4.9). */
export function createSpeechDetector({ threshold = 0.02, holdMs = 300 } = {}) {
  let aboveSince: number | null = null;
  return (level: number, now: number): boolean => {
    if (level < threshold) {
      aboveSince = null;
      return false;
    }
    aboveSince ??= now;
    return now - aboveSince >= holdMs;
  };
}

/** Maps a raw RMS level to 0..1 for meters; speech sits around 0.05–0.2 RMS. */
export const meterValue = (level: number) => Math.min(1, Math.sqrt(level / 0.25));

export type MicErrorCode = "mic_denied" | "mic_not_found" | "mic_error";

export function micErrorCode(e: unknown): MicErrorCode {
  const name = (e as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "mic_denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "mic_not_found";
  return "mic_error";
}
