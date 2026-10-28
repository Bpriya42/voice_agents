import { useEffect, useState } from "react";

export const IDLE_MS = 3000;

/** Controls dim only when idle and nothing needs them: no focus inside, no notice, not paused. */
export function dockQuiet(s: { idle: boolean; focused: boolean; attention: boolean }): boolean {
  return s.idle && !s.focused && !s.attention;
}

/** True after `ms` without pointer, key or focus activity anywhere on the page. */
export function useIdle(ms = IDLE_MS): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let t = window.setTimeout(() => setIdle(true), ms);
    const wake = () => {
      setIdle(false);
      window.clearTimeout(t);
      t = window.setTimeout(() => setIdle(true), ms);
    };
    const events = ["pointermove", "pointerdown", "keydown", "focusin", "wheel"] as const;
    for (const e of events) window.addEventListener(e, wake, { passive: true });
    return () => {
      window.clearTimeout(t);
      for (const e of events) window.removeEventListener(e, wake);
    };
  }, [ms]);
  return idle;
}
