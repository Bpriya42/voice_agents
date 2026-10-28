import { useEffect, useState } from "react";
import { useSession } from "../app/SessionProvider.js";
import { METRIC_NAMES } from "../metrics/recorder.js";

/** ?debug=1 only (arch §7): numbers and ids, never transcripts. Polls so it never re-renders the app. */
export function DebugOverlay() {
  const { controller, view } = useSession();
  const [snap, setSnap] = useState(() => controller.debugSnapshot());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setSnap(controller.debugSnapshot()), 500);
    return () => clearInterval(id);
  }, [controller]);

  const json = () =>
    JSON.stringify(
      {
        metrics: snap.metrics,
        staleEvents: snap.staleEvents,
        conversationTokens: snap.conversationTokens,
        epoch: view.debug.epoch,
      },
      null,
      2,
    );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the numbers stay visible on screen.
    }
  };

  return (
    <aside className="debug-overlay" aria-label="Debug metrics" data-testid="debug-overlay">
      <table>
        <thead>
          <tr>
            <th>metric (ms)</th>
            <th>p50</th>
            <th>p90</th>
            <th>n</th>
          </tr>
        </thead>
        <tbody>
          {METRIC_NAMES.map((name) => {
            const m = snap.metrics[name];
            return (
              <tr key={name}>
                <td>{name}</td>
                <td>{m?.p50 ?? "–"}</td>
                <td>{m?.p90 ?? "–"}</td>
                <td>{m?.n ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <dl>
        <dt>epoch</dt>
        <dd>{view.debug.epoch}</dd>
        <dt>generating</dt>
        <dd>{view.debug.generating?.slice(0, 8) ?? "–"}</dd>
        <dt>playing</dt>
        <dd>{view.debug.playing?.slice(0, 8) ?? "–"}</dd>
        <dt>stale events</dt>
        <dd>{snap.staleEvents}</dd>
        <dt>tokens (last Q&amp;A)</dt>
        <dd>{snap.conversationTokens ?? "–"}</dd>
      </dl>
      <button type="button" className="btn" onClick={() => void copy()}>
        {copied ? "Copied" : "Copy as JSON"}
      </button>
    </aside>
  );
}
