import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../engine/simulation.js";
import { Network } from "../network/network.js";
import { EventRecorder } from "../observability/recorder.js";
import { raft, type RaftState } from "../protocols/raft.js";
import { Chaos } from "../chaos/chaos.js";
import { analyze } from "./insights.js";
import { explainRaft } from "./explain.js";

function recordRaft(
  configure?: (sim: Simulation, net: Network, chaos: Chaos) => void,
): EventRecorder {
  const net = new Network();
  const sim = new Simulation({ seed: 2, transport: net });
  const rec = new EventRecorder();
  rec.attach(sim);
  for (let i = 0; i < 5; i++) sim.addNode(`n${i + 1}`, raft());
  if (configure) configure(sim, net, new Chaos(sim, net));
  sim.run({ until: 12000 });
  return rec;
}

test("the tutor explains a leader election", () => {
  const insights = analyze(recordRaft().all());
  const election = insights.find((i) => i.category === "election" && i.severity === "good");
  assert.ok(election, "should explain at least one successful election");
  assert.match(election!.title, /elected leader/);
  assert.match(election!.detail, /majority/);
});

test("the tutor explains a committed entry", () => {
  const rec = recordRaft((sim) => {
    sim.scheduleAt(3000, () => {
      const leader = sim.nodeIds().find((id) => sim.stateOf<RaftState>(id)?.role === "leader");
      if (leader) sim.inject(leader, { type: "propose", command: "x=1" }, "client");
    });
  });
  const insights = analyze(rec.all());
  assert.ok(
    insights.some((i) => i.category === "replication" && /committed/.test(i.title)),
    "should explain a commit",
  );
});

test("the tutor escalates a leader crash to critical", () => {
  const rec = recordRaft((sim, _net, chaos) => {
    // Crash whatever node is leading at t=4000.
    sim.scheduleAt(4000, () => {
      const leader = sim.nodeIds().find((id) => sim.stateOf<RaftState>(id)?.role === "leader");
      if (leader) chaos.crash(leader, sim.now + 1);
    });
  });
  const insights = analyze(rec.all());
  assert.ok(
    insights.some((i) => i.category === "fault" && i.severity === "critical"),
    "a leader crash should be critical",
  );
});

test("the tutor explains a network partition", () => {
  const rec = recordRaft((_sim, _net, chaos) => {
    chaos.partition(["n1", "n2"], 3000, 4000);
  });
  const insights = analyze(rec.all());
  const net = insights.find((i) => i.category === "network");
  assert.ok(net, "should explain the partition");
  assert.match(net!.detail, /majority/);
});

test("insights are returned in time order", () => {
  const insights = analyze(recordRaft().all());
  for (let i = 1; i < insights.length; i++) {
    assert.ok((insights[i] as { time: number }).time >= (insights[i - 1] as { time: number }).time);
  }
});

test("explainRaft describes each role distinctly", () => {
  const base: RaftState = {
    role: "follower",
    currentTerm: 3,
    votedFor: null,
    leaderId: "n2",
    log: [],
    commitIndex: 0,
    votesGranted: [],
    nextIndex: {},
    matchIndex: {},
    electionTimerId: null,
    heartbeatTimerId: null,
  };
  assert.match(explainRaft("n1", { ...base, role: "follower" }), /following n2/);
  assert.match(
    explainRaft("n1", { ...base, role: "candidate", votesGranted: ["n1"] }),
    /campaigning/,
  );
  assert.match(explainRaft("n1", { ...base, role: "leader" }), /leader for term 3/);
});
