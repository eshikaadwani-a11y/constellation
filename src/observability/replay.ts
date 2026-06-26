/**
 * Checkpointed replay — making time travel scale.
 *
 * Reconstructing the topology at a past instant by folding the whole history
 * from zero is O(n) per scrub, which becomes painful on long runs with hundreds
 * of thousands of events. {@link buildCheckpoints} periodically snapshots the
 * folded state; {@link replayTopologyAt} then resumes from the nearest earlier
 * checkpoint, making a seek O(checkpoint interval) regardless of how long the
 * simulation has been running.
 */
import type { SimEvent } from "../engine/events.js";
import type { SimTime } from "../engine/types.js";
import { TopologyModel, type TopologySnapshot } from "../topology/model.js";

export interface TopologyCheckpoint {
  /** Index into the event array immediately after this checkpoint was taken. */
  readonly index: number;
  readonly time: SimTime;
  readonly snapshot: TopologySnapshot;
}

/** Folds `events`, capturing a checkpoint every `intervalEvents` events. */
export function buildCheckpoints(
  events: readonly SimEvent[],
  intervalEvents = 2000,
): TopologyCheckpoint[] {
  if (intervalEvents <= 0) throw new RangeError("intervalEvents must be > 0");
  const checkpoints: TopologyCheckpoint[] = [];
  const model = new TopologyModel();
  for (let i = 0; i < events.length; i++) {
    model.apply(events[i] as SimEvent);
    if ((i + 1) % intervalEvents === 0) {
      const snapshot = model.snapshot();
      checkpoints.push({ index: i + 1, time: snapshot.time, snapshot });
    }
  }
  return checkpoints;
}

/**
 * Reconstructs the topology as of virtual time `time`, resuming from the latest
 * checkpoint at or before `time` instead of replaying from the beginning.
 */
export function replayTopologyAt(
  events: readonly SimEvent[],
  checkpoints: readonly TopologyCheckpoint[],
  time: SimTime,
): TopologySnapshot {
  // Binary search for the last checkpoint whose time <= target.
  let lo = 0;
  let hi = checkpoints.length - 1;
  let chosen = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((checkpoints[mid] as TopologyCheckpoint).time <= time) {
      chosen = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const start = chosen === -1 ? 0 : (checkpoints[chosen] as TopologyCheckpoint).index;
  const model =
    chosen === -1
      ? new TopologyModel()
      : TopologyModel.fromSnapshot((checkpoints[chosen] as TopologyCheckpoint).snapshot);

  for (let i = start; i < events.length; i++) {
    const event = events[i] as SimEvent;
    if (event.time > time) break;
    model.apply(event);
  }
  return model.snapshot();
}
