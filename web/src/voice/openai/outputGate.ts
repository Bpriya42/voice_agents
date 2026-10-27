import { rms } from "../../audio/micLevel.js";

export interface OutputGate {
  /** 0 is an instant mute (arch §4.9). */
  setGain(gain: 0 | 1): void;
  /** Post-gate RMS level, so it reads silence while muted. */
  level(): number;
  /** Resolves once the post-gate output has been silent for `forMs` (capped at `maxMs`). */
  whenSilent(forMs: number, maxMs?: number): Promise<void>;
  close(): void;
}

const SILENCE_RMS = 0.002;

/**
 * remote track → MediaStreamAudioSourceNode → GainNode → AnalyserNode → destination.
 * Chrome only feeds a remote WebRTC track into Web Audio while it is attached to a media element,
 * so the stream also plays through a MUTED <audio> element; audible output goes only through the
 * gain node. (Verify in spike S, arch §4.9; this is the documented fallback and is harmless if not
 * needed.)
 */
export function createOutputGate(stream: MediaStream, ctx: AudioContext): OutputGate {
  const el = new Audio();
  el.muted = true;
  el.srcObject = stream;
  void el.play().catch(() => {});

  const source = ctx.createMediaStreamSource(stream);
  const gain = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(gain).connect(analyser).connect(ctx.destination);
  const buf = new Float32Array(analyser.fftSize);
  let closed = false;

  const level = () => {
    if (closed) return 0;
    analyser.getFloatTimeDomainData(buf);
    return rms(buf);
  };

  return {
    setGain(g) {
      // setValueAtTime rather than a ramp: the mute must be immediate.
      gain.gain.setValueAtTime(g, ctx.currentTime);
    },
    level,
    whenSilent(forMs, maxMs = 1500) {
      return new Promise((resolve) => {
        const start = performance.now();
        let quietSince: number | null = null;
        const id = setInterval(() => {
          const now = performance.now();
          if (closed || now - start >= maxMs) {
            clearInterval(id);
            return resolve();
          }
          if (level() < SILENCE_RMS) {
            quietSince ??= now;
            if (now - quietSince >= forMs) {
              clearInterval(id);
              resolve();
            }
          } else quietSince = null;
        }, 20);
      });
    },
    close() {
      if (closed) return;
      closed = true;
      source.disconnect();
      gain.disconnect();
      analyser.disconnect();
      el.srcObject = null;
    },
  };
}
