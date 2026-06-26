import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../engine/simulation.js";
import { Network } from "../network/network.js";
import { constantLatency } from "../network/latency.js";
import type { NodeId } from "../engine/index.js";
import { VectorClock } from "./vectorClock.js";
import { HashRing } from "./consistentHashing.js";
import { gossip, gossipSet, type GossipState } from "./gossip.js";
import {
  twoPhaseCommitCoordinator,
  twoPhaseCommitParticipant,
  type CoordinatorState,
  type ParticipantState,
} from "./twoPhaseCommit.js";

// --- Vector clocks ---------------------------------------------------------

test("vector clocks detect happened-before", () => {
  const a = new VectorClock().tick("n1"); // {n1:1}
  const b = a.clone().tick("n2"); // {n1:1, n2:1}
  assert.equal(a.compare(b), "before");
  assert.equal(b.compare(a), "after");
});

test("vector clocks detect concurrency", () => {
  const a = new VectorClock().tick("n1");
  const b = new VectorClock().tick("n2");
  assert.equal(a.compare(b), "concurrent");
  assert.ok(a.concurrentWith(b));
});

test("merge takes the component-wise maximum", () => {
  const a = new VectorClock({ n1: 3, n2: 1 });
  const b = new VectorClock({ n1: 1, n2: 5, n3: 2 });
  a.merge(b);
  assert.deepEqual(a.toJSON(), { n1: 3, n2: 5, n3: 2 });
  assert.equal(new VectorClock({ n1: 2 }).compare(new VectorClock({ n1: 2 })), "equal");
});

// --- Consistent hashing ----------------------------------------------------

test("consistent hashing distributes keys roughly evenly", () => {
  const ring = new HashRing({ virtualNodes: 400 });
  for (const n of ["a", "b", "c", "d"]) ring.add(n);
  const counts: Record<string, number> = {};
  const keys = 20000;
  for (let i = 0; i < keys; i++) {
    const node = ring.get(`key-${i}`) as string;
    counts[node] = (counts[node] ?? 0) + 1;
  }
  const expected = keys / 4;
  for (const node of ring.nodes()) {
    const share = (counts[node] ?? 0) / expected;
    assert.ok(share > 0.7 && share < 1.3, `${node} share ${share.toFixed(2)} is unbalanced`);
  }
});

test("adding a node remaps only a small fraction of keys", () => {
  const ring = new HashRing({ virtualNodes: 200 });
  for (const n of ["a", "b", "c", "d"]) ring.add(n);
  const keys = Array.from({ length: 10000 }, (_, i) => `key-${i}`);
  const before = new Map(keys.map((k) => [k, ring.get(k)]));
  ring.add("e");
  let moved = 0;
  for (const k of keys) if (ring.get(k) !== before.get(k)) moved++;
  const fraction = moved / keys.length;
  // Naive modulo hashing would move ~80%; consistent hashing moves ~1/5.
  assert.ok(fraction < 0.35, `moved ${(fraction * 100).toFixed(1)}% of keys`);
});

test("getReplicas returns distinct nodes", () => {
  const ring = new HashRing();
  for (const n of ["a", "b", "c", "d", "e"]) ring.add(n);
  const replicas = ring.getReplicas("user:42", 3);
  assert.equal(replicas.length, 3);
  assert.equal(new Set(replicas).size, 3);
});

// --- Gossip ----------------------------------------------------------------

test("gossip disseminates a value to the whole cluster", () => {
  const sim = new Simulation({ seed: 1 });
  const ids: NodeId[] = Array.from({ length: 12 }, (_, i) => `n${i + 1}`);
  for (const id of ids) sim.addNode(id, gossip({ interval: 100 }));
  sim.inject("n1", gossipSet("leader", "n1"), "client");
  sim.run({ until: 5000 });

  for (const id of ids) {
    const state = sim.stateOf<GossipState>(id);
    assert.equal(state?.store["leader"]?.value, "n1", `${id} should have learned the value`);
  }
});

// --- Two-phase commit ------------------------------------------------------

function twoPC(seed: number, participantVotes: boolean[], latency = 1): Simulation {
  const sim = new Simulation({
    seed,
    transport: new Network({ latency: constantLatency(latency) }),
  });
  sim.addNode("coordinator", twoPhaseCommitCoordinator());
  participantVotes.forEach((v, i) => sim.addNode(`p${i + 1}`, twoPhaseCommitParticipant(v)));
  sim.inject("coordinator", { type: "2pc-begin", txId: 1 }, "client");
  return sim;
}

test("2PC commits when every participant votes yes", () => {
  const sim = twoPC(1, [true, true, true]);
  sim.run({ until: 5000 });
  assert.equal(sim.stateOf<CoordinatorState>("coordinator")?.outcome, "committed");
  for (const p of ["p1", "p2", "p3"]) {
    assert.equal(sim.stateOf<ParticipantState>(p)?.decisions[1], "committed");
  }
});

test("2PC aborts when any participant votes no", () => {
  const sim = twoPC(1, [true, false, true]);
  sim.run({ until: 5000 });
  assert.equal(sim.stateOf<CoordinatorState>("coordinator")?.outcome, "aborted");
  for (const p of ["p1", "p2", "p3"]) {
    assert.equal(sim.stateOf<ParticipantState>(p)?.decisions[1], "aborted");
  }
});

test("2PC blocks (no decision) when the coordinator crashes mid-transaction", () => {
  // 50ms links: begin arrives t=50, prepares t=100, votes would arrive t=150.
  const sim = twoPC(1, [true, true, true], 50);
  sim.run({ until: 120 }); // participants have prepared; votes still in flight
  sim.crash("coordinator"); // dies before collecting votes / deciding
  sim.run({ until: 5000 });
  // Participants prepared but never receive a decision — the classic 2PC
  // blocking problem that consensus protocols were designed to avoid.
  for (const p of ["p1", "p2", "p3"]) {
    const state = sim.stateOf<ParticipantState>(p);
    assert.equal(state?.decisions[1], undefined, `${p} should be blocked with no decision`);
    assert.equal(state?.lastVote, true, `${p} should have prepared`);
  }
});
