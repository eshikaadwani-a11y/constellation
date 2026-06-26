/**
 * Chaos engineering.
 *
 * `Chaos` schedules faults onto the simulation timeline: crashed nodes, network
 * partitions, packet-loss storms, and latency spikes — each optionally bounded
 * to a window after which the system heals. There is also a "chaos monkey" that
 * repeatedly fails random nodes.
 *
 * Faults are just scheduled events, so they share the timeline (and the
 * determinism) with everything else: a partition at t=2s in seed 42 forms at
 * exactly the same instant on every run. Each fault is scheduled with a
 * descriptive label, so it surfaces in the activity journal and on the timeline.
 */
import { Random } from "../core/prng.js";
import type { LatencyModel } from "../network/latency.js";
import type { Network } from "../network/network.js";
import type { Simulation } from "../engine/simulation.js";
import type { NodeId, SimTime } from "../engine/types.js";

export interface MonkeyOptions {
  /** Seed for the monkey's own decisions (independent of the simulation seed). */
  readonly seed?: number;
  /** How often (virtual ms) the monkey strikes. */
  readonly interval?: SimTime;
  /** How long each victim stays down. */
  readonly downtime?: SimTime;
  /** When the monkey starts. */
  readonly start?: SimTime;
  /** When the monkey stops striking. */
  readonly until?: SimTime;
}

export class Chaos {
  constructor(
    private readonly sim: Simulation,
    private readonly network: Network,
  ) {}

  /** Crashes `node` at `at`, optionally restarting it after `duration`. */
  crash(node: NodeId, at: SimTime, duration?: SimTime): void {
    this.sim.scheduleAt(at, () => this.sim.crash(node), `chaos: crash ${node}`);
    if (duration !== undefined) {
      this.sim.scheduleAt(at + duration, () => this.sim.restart(node), `chaos: restart ${node}`);
    }
  }

  /**
   * Partitions `side` from the rest of the cluster at `at`, healing after
   * `duration` (or staying split indefinitely if omitted).
   */
  partition(side: readonly NodeId[], at: SimTime, duration?: SimTime): void {
    let handle = 0;
    this.sim.scheduleAt(
      at,
      () => {
        handle = this.network.partition(side);
      },
      `chaos: partition [${side.join(", ")}]`,
    );
    if (duration !== undefined) {
      this.sim.scheduleAt(
        at + duration,
        () => this.network.heal(handle),
        `chaos: heal partition [${side.join(", ")}]`,
      );
    }
  }

  /** Raises the global packet-loss rate for a window, then clears it. */
  lossWindow(rate: number, at: SimTime, duration: SimTime): void {
    const previous = this.network.loss;
    this.sim.scheduleAt(
      at,
      () => this.network.setLossRate(rate),
      `chaos: packet loss ${Math.round(rate * 100)}%`,
    );
    this.sim.scheduleAt(
      at + duration,
      () => this.network.setLossRate(previous),
      "chaos: packet loss cleared",
    );
  }

  /** Replaces the latency model for a window, then restores it. */
  latencySpike(model: LatencyModel, at: SimTime, duration: SimTime): void {
    const previous = this.network.latencyModel;
    this.sim.scheduleAt(
      at,
      () => this.network.setLatency(model),
      `chaos: latency spike (${model.describe})`,
    );
    this.sim.scheduleAt(
      at + duration,
      () => this.network.setLatency(previous),
      "chaos: latency restored",
    );
  }

  /**
   * Unleashes a chaos monkey: at a fixed cadence it crashes a random node for a
   * while, then lets it recover. Its randomness is independent and seeded, so
   * the rampage is fully reproducible.
   */
  monkey(options: MonkeyOptions = {}): void {
    const interval = options.interval ?? 3000;
    const downtime = options.downtime ?? 2000;
    const start = options.start ?? interval;
    const until = options.until ?? Number.POSITIVE_INFINITY;
    const rng = new Random(options.seed ?? 1);

    const strike = (): void => {
      const alive = this.sim.nodeIds().filter((id) => !this.sim.isCrashed(id));
      if (alive.length > 0) {
        const victim = rng.pick(alive);
        this.crash(victim, this.sim.now + 1, downtime);
      }
      const next = this.sim.now + interval;
      if (next <= until) this.sim.scheduleAt(next, strike, "chaos: monkey");
    };

    this.sim.scheduleAt(start, strike, "chaos: monkey");
  }
}
