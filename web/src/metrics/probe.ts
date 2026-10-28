import { createOnsetDetector, createSilenceDetector } from "./silence.js";

export interface ProbeDeps {
  level: () => number;
  now?: () => number;
  /** Test seam; defaults to setInterval. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

const FRAME_MS = 20;

/**
 * Polls the post-gate output level, only while something is waiting for a sound or for silence.
 * Each waiter fires once. `onSound` receives the time of the first audible frame.
 */
export function createAudioProbe(deps: ProbeDeps) {
  const now = deps.now ?? (() => performance.now());
  const setTimer = deps.setTimer ?? ((fn, ms) => setInterval(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
  const soundWaiters = new Set<(at: number) => void>();
  const silenceWaiters = new Set<(at: number) => void>();
  const onset = createOnsetDetector();
  const silence = createSilenceDetector();
  let timer: unknown = null;

  const tick = () => {
    const level = deps.level();
    const t = now();
    if (soundWaiters.size) {
      const at = onset.feed(level, t);
      if (at !== null) fire(soundWaiters, at);
    }
    if (silenceWaiters.size) {
      const at = silence.feed(level, t);
      if (at !== null) fire(silenceWaiters, at);
    }
    if (!soundWaiters.size && !silenceWaiters.size) stop();
  };
  const fire = (set: Set<(at: number) => void>, at: number) => {
    const fns = [...set];
    set.clear();
    for (const fn of fns) fn(at);
  };
  const run = () => {
    if (timer !== null) return;
    onset.reset();
    silence.reset();
    timer = setTimer(tick, FRAME_MS);
  };
  const stop = () => {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  };

  return {
    onSound(fn: (at: number) => void) {
      soundWaiters.add(fn);
      run();
    },
    onSilence(fn: (at: number) => void) {
      silenceWaiters.add(fn);
      run();
    },
    /** Drops every waiter (End, epoch change): nothing fires after this. */
    cancel() {
      soundWaiters.clear();
      silenceWaiters.clear();
      stop();
    },
  };
}
export type AudioProbe = ReturnType<typeof createAudioProbe>;
