import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Chrome's default fake mic emits ~100 ms beeps, which never satisfy the 300 ms speech rule
 * (arch §4.9). This writes a speech-like, amplitude-modulated tone for
 * --use-file-for-fake-audio-capture instead, so no binary fixture is committed.
 */
export function writeFakeSpeechWav(seconds = 4, rate = 48_000): string {
  const path = join(tmpdir(), "ava-e2e-speech.wav");
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = 0.75 + 0.25 * Math.sin(2 * Math.PI * 3 * t);
    const f0 = 180 + 40 * Math.sin(2 * Math.PI * 0.7 * t);
    const v =
      (env *
        0.35 *
        (Math.sin(2 * Math.PI * f0 * t) +
          0.5 * Math.sin(4 * Math.PI * f0 * t) +
          0.25 * Math.sin(6 * Math.PI * f0 * t))) /
      1.75;
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  writeFileSync(path, buf);
  return path;
}
