/**
 * The networking layer.
 *
 * `Network` is the production-grade {@link Transport}: it adds realistic latency
 * (via a {@link LatencyModel}), independent packet loss, and time-windowed
 * partitions on top of the bare engine. Because every decision is drawn from the
 * simulation's deterministic stream, a lossy, partitioned run is exactly as
 * reproducible as a perfect one.
 *
 * Reordering is not modelled explicitly — it falls out for free, since two
 * messages on the same link can draw different latencies and arrive out of order.
 *
 * Retries are deliberately *not* a network feature: re-sending on timeout is a
 * protocol responsibility (see `network.test.ts` for a reliable-delivery
 * protocol that rides on top of a lossy `Network`).
 */
import type { Random } from "../core/prng.js";
import type { Transport, TransportDecision } from "../engine/transport.js";
import type { Envelope, NodeId, SimTime } from "../engine/types.js";
import { constantLatency, type LatencyModel } from "./latency.js";

export interface NetworkOptions {
  /** Delivery delay model. Defaults to a constant 10ms. */
  readonly latency?: LatencyModel;
  /** Probability in [0, 1] that any given message is silently dropped. */
  readonly lossRate?: number;
}

/** A scheduled split: traffic between `side` and its complement is blocked. */
interface Partition {
  readonly id: number;
  readonly side: ReadonlySet<NodeId>;
  readonly start: SimTime;
  readonly end: SimTime;
}

export interface PartitionWindow {
  /** Virtual time the partition begins. Defaults to "always" (-∞). */
  readonly start?: SimTime;
  /** Virtual time the partition heals. Defaults to "never" (+∞). */
  readonly end?: SimTime;
}

export class Network implements Transport {
  private latency: LatencyModel;
  private lossRate: number;
  private readonly partitions: Partition[] = [];
  private nextPartitionId = 1;

  constructor(options: NetworkOptions = {}) {
    this.latency = options.latency ?? constantLatency(10);
    this.lossRate = clampProbability(options.lossRate ?? 0);
  }

  route(envelope: Envelope, rng: Random, now: SimTime): TransportDecision {
    if (this.isBlocked(envelope.from, envelope.to, now)) {
      return { deliver: false, latency: 0, reason: "partition" };
    }
    if (this.lossRate > 0 && rng.bernoulli(this.lossRate)) {
      return { deliver: false, latency: 0, reason: "loss" };
    }
    return { deliver: true, latency: Math.max(0, this.latency.sample(rng)) };
  }

  /** True if `a` and `b` are separated by an active partition at time `now`. */
  isBlocked(a: NodeId, b: NodeId, now: SimTime): boolean {
    for (const p of this.partitions) {
      if (now < p.start || now >= p.end) continue;
      if (p.side.has(a) !== p.side.has(b)) return true;
    }
    return false;
  }

  /**
   * Splits the cluster: during the window, no traffic flows between `side` and
   * the rest. Returns an id that can be passed to {@link heal}.
   */
  partition(side: readonly NodeId[], window: PartitionWindow = {}): number {
    const id = this.nextPartitionId++;
    this.partitions.push({
      id,
      side: new Set(side),
      start: window.start ?? Number.NEGATIVE_INFINITY,
      end: window.end ?? Number.POSITIVE_INFINITY,
    });
    return id;
  }

  /** Removes a partition by id. Returns whether one was removed. */
  heal(id: number): boolean {
    const index = this.partitions.findIndex((p) => p.id === id);
    if (index === -1) return false;
    this.partitions.splice(index, 1);
    return true;
  }

  /** Removes every partition, fully reconnecting the cluster. */
  healAll(): void {
    this.partitions.length = 0;
  }

  /** Number of partitions currently configured (regardless of window). */
  get partitionCount(): number {
    return this.partitions.length;
  }

  /** Replaces the latency model at runtime (used by the chaos controls). */
  setLatency(model: LatencyModel): void {
    this.latency = model;
  }

  /** Adjusts the packet-loss probability at runtime. */
  setLossRate(rate: number): void {
    this.lossRate = clampProbability(rate);
  }

  get loss(): number {
    return this.lossRate;
  }

  get latencyModel(): LatencyModel {
    return this.latency;
  }
}

function clampProbability(p: number): number {
  if (Number.isNaN(p)) return 0;
  return Math.min(1, Math.max(0, p));
}
