/**
 * The transport seam.
 *
 * `ctx.send` does not deliver instantly — it hands the message to a transport,
 * which decides how long delivery takes and whether it happens at all. This
 * single interface is where the full networking model (latency distributions,
 * packet loss, reordering, partitions) plugs in during milestone 4.
 *
 * For the bare engine, {@link FixedLatencyTransport} provides a deterministic,
 * lossless link with a constant delay — enough to exercise message ordering and
 * timers without yet modelling failure.
 */
import type { Random } from "../core/prng.js";
import type { Envelope, SimTime } from "./types.js";

export interface TransportDecision {
  /** Virtual ms before the message is delivered. */
  readonly latency: SimTime;
  /** Whether the message should be delivered at all. */
  readonly deliver: boolean;
  /** When `deliver` is false, a short reason for observability. */
  readonly reason?: string;
}

export interface Transport {
  /**
   * Decides the fate of a message at send time. Implementations must draw any
   * randomness exclusively from `rng` to stay deterministic.
   */
  route(envelope: Envelope, rng: Random, now: SimTime): TransportDecision;
}

/** A deterministic, lossless link with a constant delay. */
export class FixedLatencyTransport implements Transport {
  constructor(private readonly latency: SimTime = 1) {
    if (latency < 0) throw new RangeError("latency must be >= 0");
  }

  route(): TransportDecision {
    return { latency: this.latency, deliver: true };
  }
}
