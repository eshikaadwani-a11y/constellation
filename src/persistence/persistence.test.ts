import { test } from "node:test";
import assert from "node:assert/strict";
import { EventRecorder } from "../observability/recorder.js";
import type { RaftState } from "../protocols/raft.js";
import { leaderOf } from "../protocols/raft.js";
import { defaultRegistry } from "../registry.js";
import {
  buildSimulation,
  parseScenario,
  serializeScenario,
  type ScenarioSpec,
} from "./scenario.js";
import { parseEvents, serializeEvents } from "./eventLog.js";

const raftSpec: ScenarioSpec = {
  version: 1,
  name: "five-node raft",
  seed: 7,
  network: { latency: { kind: "uniform", min: 5, max: 20 } },
  nodes: Array.from({ length: 5 }, (_, i) => ({
    id: `n${i + 1}`,
    protocol: "raft",
    options: { electionTimeoutMin: 150, electionTimeoutMax: 300, heartbeatInterval: 50 },
  })),
  events: [{ at: 3000, kind: "crash", node: "n1", duration: 2000 }],
};

function fingerprint(events: ReturnType<EventRecorder["all"]>): string {
  return events.map((e) => `${e.seq}:${e.kind}@${e.time}`).join("|");
}

test("the registry creates protocols by name", () => {
  const registry = defaultRegistry();
  assert.ok(registry.has("raft"));
  assert.equal(registry.create("raft", {}).name, "raft");
  assert.throws(() => registry.create("nope"));
});

test("a scenario spec round-trips through JSON", () => {
  const json = serializeScenario(raftSpec);
  assert.deepEqual(parseScenario(json), raftSpec);
});

test("parsing rejects an unknown version", () => {
  assert.throws(() => parseScenario(JSON.stringify({ version: 99, seed: 1, nodes: [] })));
});

test("building the same spec twice reproduces the run exactly", () => {
  const run = (): string => {
    const { sim } = buildSimulation(raftSpec);
    const rec = new EventRecorder();
    rec.attach(sim);
    sim.run({ until: 8000 });
    return fingerprint(rec.all());
  };
  assert.equal(run(), run(), "identical specs must produce identical event streams");
});

test("a loaded spec actually runs the encoded protocol", () => {
  const { sim } = buildSimulation(raftSpec);
  sim.run({ until: 3000 });
  const states = new Map(sim.nodeIds().map((id) => [id, sim.stateOf<RaftState>(id) as RaftState]));
  assert.notEqual(leaderOf(states), null, "the raft cluster should elect a leader");
});

test("scheduled faults in a spec take effect", () => {
  const { sim } = buildSimulation(raftSpec);
  const crashed: string[] = [];
  sim.subscribe((e) => {
    if (e.kind === "node:crashed") crashed.push(e.nodeId);
  });
  sim.run({ until: 8000 });
  assert.ok(crashed.includes("n1"), "the spec's scheduled crash should fire");
});

test("event logs round-trip through JSON", () => {
  const { sim } = buildSimulation(raftSpec);
  const rec = new EventRecorder();
  rec.attach(sim);
  sim.run({ until: 4000 });

  const restored = parseEvents(serializeEvents(rec.all()));
  assert.deepEqual(restored, [...rec.all()]);
});

test("parseEvents rejects a foreign document", () => {
  assert.throws(() => parseEvents(JSON.stringify({ format: "something-else", events: [] })));
});
