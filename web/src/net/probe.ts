/** Timeout for one health probe (arch §6.5). */
export const PROBE_TIMEOUT_MS = 2000;

/**
 * Timed probe of /api/health. `navigator.onLine` is only a hint (arch §6.5), so connectivity
 * changes are confirmed by a real request. Probes run one at a time: callers that arrive while a
 * probe is in flight share its result.
 */
export class HealthProbe {
  private inFlight: Promise<boolean> | null = null;

  constructor(
    private doFetch: typeof fetch = (...a) => fetch(...a),
    private timeoutMs = PROBE_TIMEOUT_MS,
    private url = "/api/health",
  ) {}

  get busy() {
    return this.inFlight !== null;
  }

  check = (): Promise<boolean> => {
    if (this.inFlight) return this.inFlight;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    const p = this.doFetch(this.url, { signal: ctl.signal, cache: "no-store" })
      .then(() => true) // any HTTP answer means the network is up
      .catch(() => false)
      .finally(() => {
        clearTimeout(timer);
        this.inFlight = null;
      });
    this.inFlight = p;
    return p;
  };
}

/** Connectivity hints from the browser's `online` / `offline` events. Returns the unsubscribe. */
export function watchConnectivity(
  target: Pick<EventTarget, "addEventListener" | "removeEventListener">,
  onHint: (online: boolean) => void,
): () => void {
  const on = () => onHint(true);
  const off = () => onHint(false);
  target.addEventListener("online", on);
  target.addEventListener("offline", off);
  return () => {
    target.removeEventListener("online", on);
    target.removeEventListener("offline", off);
  };
}
