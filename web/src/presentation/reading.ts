/** A comfortable on-screen reading pace, slower than skimming (brief §7.4, text mode). */
export const READING_WPM = 200;
/** Time to find the new caption before reading it. */
export const READING_BASE_MS = 1_000;

/**
 * How long a sentence stays up before the next one in text mode. At normal speech pace (about
 * 150 wpm) the audio is already longer, so this only holds the talk when audio is short or missing.
 */
export function readingMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return READING_BASE_MS + Math.round((words * 60_000) / READING_WPM);
}
