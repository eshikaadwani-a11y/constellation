/**
 * Event recording — the substrate for replay and time-travel.
 *
 * An {@link EventRecorder} captures the engine's event stream into an ordered,
 * append-only history. Because the stream is the complete, ordered truth of a
 * run, the history can be re-folded into any derived view (topology, metrics,
 * logs, traces) at any past point in time — which is exactly how the timeline
 * scrubber implements time travel without re-running the engine.
 */
import type { SimEvent } from "../engine/events.js";
import type { Simulation } from "../engine/simulation.js";
import type { SimTime } from "../engine/types.js";

export interface RecorderOptions {
  /** Optional cap on retained events (oldest dropped first). Default: unbounded. */
  readonly cap?: number;
}

export class EventRecorder {
  private readonly events: SimEvent[] = [];
  private readonly cap: number;

  constructor(options: RecorderOptions = {}) {
    this.cap = options.cap ?? Number.POSITIVE_INFINITY;
  }

  /** Appends an event to the history. */
  record(event: SimEvent): void {
    this.events.push(event);
    if (this.events.length > this.cap) this.events.shift();
  }

  /** Subscribes the recorder to a simulation. Returns an unsubscribe function. */
  attach(sim: Simulation): () => void {
    return sim.subscribe((event) => this.record(event));
  }

  /** The full recorded history (do not mutate). */
  all(): readonly SimEvent[] {
    return this.events;
  }

  get length(): number {
    return this.events.length;
  }

  /** Virtual time of the last recorded event, or 0 if empty. */
  get duration(): SimTime {
    return this.events.length === 0 ? 0 : (this.events[this.events.length - 1] as SimEvent).time;
  }

  /** Every event at or before the given virtual time (for time-travel folds). */
  until(time: SimTime): SimEvent[] {
    return this.events.filter((e) => e.time <= time);
  }

  clear(): void {
    this.events.length = 0;
  }
}
