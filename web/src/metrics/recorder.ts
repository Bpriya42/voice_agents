import { percentile } from "./percentile.js";

/** The metrics of arch §7. */
export const METRIC_NAMES = [
  "bargeIn",
  "answerLatency",
  "typedLatency",
  "slideSync",
  "narrationGap",
  "toolRoundTrip",
  "greeting",
] as const;
export type MetricName = (typeof METRIC_NAMES)[number];

export interface MetricSummary {
  p50: number;
  p90: number;
  n: number;
}

/** Keeps the samples of a long session bounded. */
const MAX_SAMPLES = 200;

/**
 * Start/stop marks keyed by metric name. A stop without a start is ignored, a second start restarts
 * the mark, and nothing here touches the network or the DOM.
 */
export class MetricsRecorder {
  private marks = new Map<MetricName, number>();
  private samples = new Map<MetricName, number[]>();

  constructor(private now: () => number = () => performance.now()) {}

  start(name: MetricName, at: number = this.now()) {
    this.marks.set(name, at);
  }

  isRunning(name: MetricName) {
    return this.marks.has(name);
  }

  /** Returns the elapsed ms, or null when there was no start. */
  stop(name: MetricName, at: number = this.now()): number | null {
    const started = this.marks.get(name);
    if (started === undefined) return null;
    this.marks.delete(name);
    return this.record(name, at - started);
  }

  cancel(...names: MetricName[]) {
    for (const n of names) this.marks.delete(n);
  }

  cancelAll() {
    this.marks.clear();
  }

  /** Adds a finished measurement directly. Negative or non-finite values are dropped. */
  record(name: MetricName, ms: number): number | null {
    if (!Number.isFinite(ms) || ms < 0) return null;
    const list = this.samples.get(name) ?? [];
    list.push(ms);
    if (list.length > MAX_SAMPLES) list.shift();
    this.samples.set(name, list);
    return ms;
  }

  summary(): Partial<Record<MetricName, MetricSummary>> {
    const out: Partial<Record<MetricName, MetricSummary>> = {};
    for (const [name, values] of this.samples) {
      out[name] = {
        p50: Math.round(percentile(values, 50)!),
        p90: Math.round(percentile(values, 90)!),
        n: values.length,
      };
    }
    return out;
  }

  reset() {
    this.marks.clear();
    this.samples.clear();
  }
}
