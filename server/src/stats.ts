import { Hono } from "hono";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { MetricsReport } from "@ava/shared";
import type { Deps } from "./app.js";

const MAX_METRIC_NAMES = 50;

interface Agg {
  reports: number;
  samples: number;
  p50Sum: number;
  p90Sum: number;
  p90Max: number;
}

/** Anonymous in-memory counters (arch §8): event and flag names with numbers, nothing else. */
export function createStats() {
  const counters = new Map<string, number>();
  const metrics = new Map<string, Agg>();
  return {
    count(name: string) {
      counters.set(name, (counters.get(name) ?? 0) + 1);
    },
    addMetrics(report: z.infer<typeof MetricsReport>["metrics"]) {
      for (const [name, m] of Object.entries(report)) {
        let a = metrics.get(name);
        if (!a) {
          if (metrics.size >= MAX_METRIC_NAMES) continue;
          a = { reports: 0, samples: 0, p50Sum: 0, p90Sum: 0, p90Max: 0 };
          metrics.set(name, a);
        }
        a.reports += 1;
        a.samples += m.n;
        a.p50Sum += m.p50;
        a.p90Sum += m.p90;
        a.p90Max = Math.max(a.p90Max, m.p90);
      }
    },
    snapshot() {
      return {
        counters: Object.fromEntries(counters),
        metrics: Object.fromEntries(
          [...metrics].map(([name, a]) => [
            name,
            {
              reports: a.reports,
              samples: a.samples,
              meanP50: Math.round(a.p50Sum / a.reports),
              meanP90: Math.round(a.p90Sum / a.reports),
              maxP90: a.p90Max,
            },
          ]),
        ),
      };
    },
  };
}
export type Stats = ReturnType<typeof createStats>;

// Hashing both sides gives equal lengths, so the compare is constant-time for any input.
const digest = (s: string) => createHash("sha256").update(s).digest();
const tokenMatches = (header: string | undefined, token: string) =>
  timingSafeEqual(digest(header ?? ""), digest(`Bearer ${token}`));

/** GET /api/stats (needs the STATS_TOKEN bearer, else 404) and POST /api/metrics (arch §3.1). */
export function statsRoutes(deps: Deps, stats: Stats) {
  const r = new Hono();

  r.get("/stats", (c) => {
    const token = deps.config.STATS_TOKEN;
    if (!token || !tokenMatches(c.req.header("authorization"), token)) {
      return c.json({ code: "not_found" }, 404);
    }
    return c.json(stats.snapshot());
  });

  r.post("/metrics", async (c) => {
    // sendBeacon may post the JSON as text/plain, so parse the body text rather than trust the type.
    let raw: unknown;
    try {
      raw = JSON.parse(await c.req.text());
    } catch {
      return c.json({ code: "bad_request" }, 400);
    }
    const parsed = MetricsReport.safeParse(raw);
    if (!parsed.success) return c.json({ code: "bad_request" }, 400);
    stats.addMetrics(parsed.data.metrics);
    return c.body(null, 204);
  });

  return r;
}
