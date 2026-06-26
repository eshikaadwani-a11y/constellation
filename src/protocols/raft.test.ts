import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../engine/simulation.js";
import type { NodeId, SimEvent } from "../engine/index.js";
import { leaderOf, raft, type RaftState } from "./raft.js";

function cluster(
  size: number,
  seed: number,
): { sim: Simulation; ids: NodeId[]; states(): Map<NodeId, RaftState> } {
  const sim = new Simulation({ seed });
  const ids = Array.from({ length: size }, (_, i) => `n${i + 1}`);
  for (const id of ids) sim.addNode(id, raft());
  return {
    sim,
    ids,
    states: () => new Map(ids.map((id) => [id, sim.stateOf<RaftState>(id) as RaftState])),
  };
}

test("a stable cluster elects exactly one leader", () => {
  const c = cluster(5, 1);
  c.sim.run({ until: 5000 });
  const leaders = [...c.states().values()].filter((s) => s.role === "leader");
  assert.equal(leaders.length, 1, "exactly one node should consider itself leader");
  assert.notEqual(leaderOf(c.states()), null);
});

test("election safety: at most one leader per term", () => {
  const sim = new Simulation({ seed: 3 });
  const leadersByTerm = new Map<number, Set<NodeId>>();
  sim.subscribe((e: SimEvent) => {
    if (e.kind === "log" && e.message === "becomes leader") {
      const term = e.fields.term as number;
      const set = leadersByTerm.get(term) ?? new Set();
      set.add(e.nodeId);
      leadersByTerm.set(term, set);
    }
  });
  for (let i = 0; i < 5; i++) sim.addNode(`n${i + 1}`, raft());
  sim.run({ until: 8000 });

  for (const [term, leaders] of leadersByTerm) {
    assert.equal(leaders.size, 1, `term ${term} had multiple leaders: ${[...leaders]}`);
  }
});

test("a committed client command replicates to the whole cluster", () => {
  const c = cluster(5, 2);
  c.sim.run({ until: 3000 });
  const leader = leaderOf(c.states());
  assert.notEqual(leader, null);

  c.sim.inject(leader as NodeId, { type: "propose", command: "x=1" }, "client");
  c.sim.run({ until: 8000 });

  const states = c.states();
  for (const id of c.ids) {
    const s = states.get(id) as RaftState;
    assert.ok(s.log.length >= 1, `${id} should have the entry`);
    assert.equal(s.log[0]?.command, "x=1");
    assert.ok(s.commitIndex >= 1, `${id} should have committed the entry`);
  }
});

test("logs are identical across the cluster after replication", () => {
  const c = cluster(5, 5);
  c.sim.run({ until: 2000 });
  for (const cmd of ["a", "b", "c"]) {
    const leader = leaderOf(c.states());
    if (leader) c.sim.inject(leader, { type: "propose", command: cmd }, "client");
    c.sim.run({ until: c.sim.now + 1500 });
  }
  c.sim.run({ until: c.sim.now + 3000 });

  const logs = c.ids.map((id) =>
    (c.states().get(id) as RaftState).log.map((e) => e.command).join(","),
  );
  for (const log of logs) assert.equal(log, logs[0], "all logs must match the leader's");
  assert.equal(logs[0], "a,b,c");
});

test("a new leader is elected after the leader crashes", () => {
  const c = cluster(5, 4);
  c.sim.run({ until: 3000 });
  const first = leaderOf(c.states());
  assert.notEqual(first, null);

  c.sim.crash(first as NodeId);
  c.sim.run({ until: 10000 });

  // The crashed node keeps its stale "leader" role frozen in its state, so we
  // look only at nodes that are still alive.
  const live = new Map([...c.states()].filter(([id]) => !c.sim.isCrashed(id)));
  const second = leaderOf(live);
  assert.notEqual(second, null, "a new leader should emerge");
  assert.notEqual(second, first, "the crashed node cannot be the new leader");
  const newTerm = (live.get(second as NodeId) as RaftState).currentTerm;
  const oldTerm = (c.states().get(first as NodeId) as RaftState).currentTerm;
  assert.ok(newTerm > oldTerm, "the new leader's term must be higher");
});

test("leader election is deterministic for a fixed seed", () => {
  const a = cluster(5, 42);
  a.sim.run({ until: 5000 });
  const b = cluster(5, 42);
  b.sim.run({ until: 5000 });
  assert.equal(leaderOf(a.states()), leaderOf(b.states()));
});

test("a single-node cluster elects itself immediately", () => {
  const c = cluster(1, 1);
  c.sim.run({ until: 500 });
  assert.equal((c.states().get("n1") as RaftState).role, "leader");
});
