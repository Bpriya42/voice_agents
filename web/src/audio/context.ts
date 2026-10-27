let ctx: AudioContext | null = null;

/** One AudioContext for the mic meter and the output gate. Created lazily, resumed on Start. */
export function getAudioContext(): AudioContext {
  ctx ??= new AudioContext();
  return ctx;
}

/** The Start click resumes the context (autoplay unlock, arch §4.9). Resolves false if still blocked. */
export async function unlockAudio(): Promise<boolean> {
  const c = getAudioContext();
  if (c.state === "running") return true;
  try {
    await c.resume();
  } catch {
    return false;
  }
  return (c.state as AudioContextState) === "running";
}
