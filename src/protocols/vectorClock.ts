/**
 * Vector clocks — capturing causality in a distributed system.
 *
 * A vector clock assigns each event a vector of per-node counters. Comparing two
 * vectors tells you whether one event *happened before* another, or whether they
 * are *concurrent* (causally independent) — the distinction physical timestamps
 * cannot make. This is the foundation of causal consistency, conflict detection
 * in Dynamo-style stores, and session guarantees.
 */
import type { NodeId } from "../engine/types.js";

export type Ordering = "before" | "after" | "equal" | "concurrent";

export class VectorClock {
  private readonly v: Map<NodeId, number>;

  constructor(initial?: Readonly<Record<NodeId, number>>) {
    this.v = new Map(initial ? Object.entries(initial) : []);
  }

  /** The counter for `id` (0 if never seen). */
  get(id: NodeId): number {
    return this.v.get(id) ?? 0;
  }

  /** Advances this clock for a local event on `id`. Mutates and returns `this`. */
  tick(id: NodeId): this {
    this.v.set(id, this.get(id) + 1);
    return this;
  }

  /** Merges in another clock by taking the component-wise maximum. */
  merge(other: VectorClock): this {
    for (const [id, count] of other.v) {
      if (count > this.get(id)) this.v.set(id, count);
    }
    return this;
  }

  /**
   * Causal comparison:
   *   - `before`     — this happened-before other,
   *   - `after`      — other happened-before this,
   *   - `equal`      — identical,
   *   - `concurrent` — causally independent (a conflict).
   */
  compare(other: VectorClock): Ordering {
    let lessSomewhere = false;
    let greaterSomewhere = false;
    const ids = new Set<NodeId>([...this.v.keys(), ...other.v.keys()]);
    for (const id of ids) {
      const a = this.get(id);
      const b = other.get(id);
      if (a < b) lessSomewhere = true;
      else if (a > b) greaterSomewhere = true;
    }
    if (lessSomewhere && greaterSomewhere) return "concurrent";
    if (lessSomewhere) return "before";
    if (greaterSomewhere) return "after";
    return "equal";
  }

  /** True when this and other are causally independent. */
  concurrentWith(other: VectorClock): boolean {
    return this.compare(other) === "concurrent";
  }

  clone(): VectorClock {
    return new VectorClock(this.toJSON());
  }

  toJSON(): Record<NodeId, number> {
    return Object.fromEntries(this.v);
  }
}
