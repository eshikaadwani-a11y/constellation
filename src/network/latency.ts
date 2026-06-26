/**
 * Latency models.
 *
 * A {@link LatencyModel} turns the deterministic random stream into a delivery
 * delay. Real networks rarely have constant latency, so the engine ships the
 * distributions that matter for distributed-systems intuition: uniform jitter,
 * a normal "bell" around a baseline, and an exponential tail that produces the
 * occasional slow packet which so often triggers spurious timeouts.
 *
 * Every model draws exclusively from the supplied generator, so latency is as
 * reproducible as everything else in a run.
 */
import type { Random } from "../core/prng.js";
import type { SimTime } from "../engine/types.js";

export interface LatencyModel {
  /** Returns a non-negative delay in virtual milliseconds. */
  sample(rng: Random): SimTime;
  /** A short human-readable description for the UI. */
  readonly describe: string;
}

/** Every message takes exactly `ms`. */
export function constantLatency(ms: SimTime): LatencyModel {
  if (ms < 0) throw new RangeError("latency must be >= 0");
  return { sample: () => ms, describe: `${ms}ms` };
}

/** Uniformly distributed between `min` and `max`. */
export function uniformLatency(min: SimTime, max: SimTime): LatencyModel {
  if (min < 0 || max < min) throw new RangeError("require 0 <= min <= max");
  return { sample: (rng) => rng.float(min, max), describe: `${min}–${max}ms` };
}

/**
 * Normally distributed around `mean` with the given standard deviation, clamped
 * at zero so a sample never goes back in time.
 */
export function normalLatency(mean: SimTime, stdDev: SimTime, min: SimTime = 0): LatencyModel {
  if (mean < 0 || stdDev < 0) throw new RangeError("mean and stdDev must be >= 0");
  return {
    sample: (rng) => Math.max(min, rng.normal(mean, stdDev)),
    describe: `${mean}±${stdDev}ms`,
  };
}

/**
 * Exponentially distributed with the given mean — a memoryless model with a
 * long tail, good for surfacing how protocols cope with rare slow messages.
 */
export function exponentialLatency(mean: SimTime): LatencyModel {
  if (mean <= 0) throw new RangeError("mean must be > 0");
  return { sample: (rng) => rng.exponential(mean), describe: `~${mean}ms (exp)` };
}
