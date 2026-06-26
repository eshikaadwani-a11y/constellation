/**
 * Deterministic pseudo-random number generation.
 *
 * Determinism is the foundation of Constellation: an entire simulation — every
 * message delay, every dropped packet, every election timeout — must be a pure
 * function of a single 32-bit seed. That property is what makes simulations
 * perfectly reproducible and replayable.
 *
 * The generator is `mulberry32`, a compact, well-distributed 32-bit PRNG. It is
 * seeded through `splitmix32` so that nearby seeds (0, 1, 2, ...) produce
 * statistically independent streams rather than correlated ones.
 */

/** Mixes a 32-bit seed so that sequential seeds yield independent streams. */
function splitmix32(seed: number): number {
  let z = (seed + 0x9e3779b9) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  return (z ^ (z >>> 15)) >>> 0;
}

export class Random {
  /** Current internal state. Exposed for snapshotting and deterministic forks. */
  private state: number;

  constructor(seed: number) {
    this.state = splitmix32(seed >>> 0);
  }

  /** Returns the raw internal state so a run can be snapshotted and resumed. */
  snapshot(): number {
    return this.state;
  }

  /** Restores a previously captured internal state. */
  restore(state: number): void {
    this.state = state >>> 0;
  }

  /** Next float in the half-open interval [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    if (max < min) throw new RangeError(`int(${min}, ${max}): empty range`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Returns true with the given probability (clamped to [0, 1]). */
  bernoulli(probability: number): boolean {
    if (probability <= 0) return false;
    if (probability >= 1) return true;
    return this.next() < probability;
  }

  /**
   * Exponentially distributed sample with the given mean. This is the natural
   * model for inter-arrival times and tail latency in queueing systems.
   */
  exponential(mean: number): number {
    if (mean <= 0) throw new RangeError(`exponential mean must be > 0, got ${mean}`);
    // Guard against log(0) producing Infinity.
    const u = 1 - this.next();
    return -Math.log(u) * mean;
  }

  /**
   * Normally distributed sample (Box–Muller transform). Useful for modelling
   * symmetric jitter around a baseline latency.
   */
  normal(mean = 0, stdDev = 1): number {
    const u1 = 1 - this.next();
    const u2 = this.next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z * stdDev;
  }

  /** Picks a uniformly random element. Throws on an empty list. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError("pick() from empty array");
    return items[this.int(0, items.length - 1)] as T;
  }

  /** Returns a Fisher–Yates shuffled copy, leaving the input untouched. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  }

  /** Creates an independent generator derived deterministically from this one. */
  fork(): Random {
    return new Random(this.state ^ 0x9e3779b9);
  }
}
