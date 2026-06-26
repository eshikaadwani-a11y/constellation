/**
 * Metrics — derived purely by folding the event stream.
 *
 * No counters live in the engine; throughput, loss, and the like are computed
 * after the fact from the recorded history. This keeps the engine lean and means
 * a metric can be added retroactively over an old run with no re-simulation.
 */
import type { SimEvent } from "../engine/events.js";
import type { SimTime } from "../engine/types.js";

export interface MetricBucket {
  /** Start time of the bucket (virtual ms). */
  readonly t: SimTime;
  readonly sent: number;
  readonly delivered: number;
  readonly dropped: number;
}

export interface MetricsSummary {
  readonly bucketMs: number;
  readonly buckets: MetricBucket[];
  readonly totals: {
    sent: number;
    delivered: number;
    dropped: number;
    logs: number;
  };
  /** Delivered / (delivered + dropped); 1 when no traffic. */
  readonly deliveryRatio: number;
}

/** Folds events into fixed-width time buckets plus run totals. */
export function computeMetrics(events: readonly SimEvent[], bucketMs = 100): MetricsSummary {
  if (bucketMs <= 0) throw new RangeError("bucketMs must be > 0");
  const byBucket = new Map<number, { sent: number; delivered: number; dropped: number }>();
  const totals = { sent: 0, delivered: 0, dropped: 0, logs: 0 };

  const bump = (time: SimTime, key: "sent" | "delivered" | "dropped"): void => {
    const t = Math.floor(time / bucketMs) * bucketMs;
    const bucket = byBucket.get(t) ?? { sent: 0, delivered: 0, dropped: 0 };
    bucket[key]++;
    byBucket.set(t, bucket);
    totals[key]++;
  };

  for (const e of events) {
    switch (e.kind) {
      case "message:sent":
        bump(e.time, "sent");
        break;
      case "message:delivered":
        bump(e.time, "delivered");
        break;
      case "message:dropped":
        bump(e.time, "dropped");
        break;
      case "log":
        totals.logs++;
        break;
      default:
        break;
    }
  }

  const buckets: MetricBucket[] = [...byBucket.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, c]) => ({ t, sent: c.sent, delivered: c.delivered, dropped: c.dropped }));

  const resolved = totals.delivered + totals.dropped;
  return {
    bucketMs,
    buckets,
    totals,
    deliveryRatio: resolved === 0 ? 1 : totals.delivered / resolved,
  };
}
