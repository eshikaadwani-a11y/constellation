import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../engine/simulation.js";
import { TopologyModel } from "../topology/model.js";
import { raft } from "../protocols/raft.js";
import { EventRecorder } from "./recorder.js";
import { buildCheckpoints, replayTopologyAt } from "./replay.js";

function recordRaft(nodes: number, until: number): EventRecorder {
  const sim = new Simulation({ seed: 3 });
  const rec = new EventRecorder();
  rec.attach(sim);
  for (let i = 0; i < nodes; i++) sim.addNode(`n${i + 1}`, raft());
  sim.run({ until });
  return rec;
}

/** Naive reference: fold the whole prefix from scratch. */
function naiveAt(events: ReturnType<EventRecorder["all"]>, time: number) {
  const model = new TopologyModel();
  for (const e of events) {
    if (e.time > time) break;
    model.apply(e);
  }
  return model.snapshot();
}

test("checkpointed replay matches a naive fold at every probe", () => {
  const rec = recordRaft(7, 6000);
  const events = rec.all();
  const checkpoints = buildCheckpoints(events, 500);
  assert.ok(checkpoints.length > 0, "a long run should produce checkpoints");

  for (const frac of [0, 0.1, 0.37, 0.5, 0.83, 1]) {
    const t = Math.floor(rec.duration * frac);
    assert.deepEqual(replayTopologyAt(events, checkpoints, t), naiveAt(events, t), `at t=${t}`);
  }
});

test("replay before the first checkpoint folds from the start", () => {
  const rec = recordRaft(5, 4000);
  const events = rec.all();
  const checkpoints = buildCheckpoints(events, 100000); // effectively no checkpoints
  const t = Math.floor(rec.duration / 3);
  assert.deepEqual(replayTopologyAt(events, checkpoints, t), naiveAt(events, t));
});

test("fromSnapshot round-trips a model's observable state", () => {
  const rec = recordRaft(5, 3000);
  const model = new TopologyModel();
  for (const e of rec.all()) model.apply(e);
  const snap = model.snapshot();
  const rebuilt = TopologyModel.fromSnapshot(snap).snapshot();
  assert.deepEqual(rebuilt, snap);
});
