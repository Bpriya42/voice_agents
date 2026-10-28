/** Post-gate RMS below this reads as silence (matches the output gate's own threshold). */
export const SILENCE_RMS = 0.002;
/** RMS above this counts as sound for "first non-silent frame". */
export const SOUND_RMS = 0.004;

/**
 * Sound onset: needs `frames` consecutive frames above the threshold, so one click or a stray
 * frame is not "the first audible frame". Returns the time of the first frame of the run.
 */
export function createOnsetDetector({ threshold = SOUND_RMS, frames = 2 } = {}) {
  let count = 0;
  let firstAt = 0;
  return {
    feed(level: number, now: number): number | null {
      if (level < threshold) {
        count = 0;
        return null;
      }
      if (count === 0) firstAt = now;
      count++;
      return count >= frames ? firstAt : null;
    },
    reset() {
      count = 0;
    },
  };
}

/**
 * Silence: level below the threshold continuously for at least `minMs`, so a short pause inside a
 * sentence is not "silent". Returns the time the silent run began (not when it was confirmed), so
 * the confirmation delay is not added to a barge-in measurement.
 */
export function createSilenceDetector({ threshold = SILENCE_RMS, minMs = 80 } = {}) {
  let since: number | null = null;
  return {
    feed(level: number, now: number): number | null {
      if (level >= threshold) {
        since = null;
        return null;
      }
      since ??= now;
      return now - since >= minMs ? since : null;
    },
    reset() {
      since = null;
    },
  };
}
