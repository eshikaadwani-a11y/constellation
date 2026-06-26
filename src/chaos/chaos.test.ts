import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../engine/simulation.js";
import type { Message, Protocol, SimEvent } from "../engine/index.js";
import { Network } from "../network/network.js";
import { constantLatency } from "../network/latency.js";
import { Chaos } from "./chaos.js";

/** An echo node: replies "pong" to any "ping". */
function echo(): Protocol<null, Message> {
  return {
    name: "echo",
    init: () => null,
    onMessage(ctx, state, from, message) {
      if (message.type === "ping") ctx.send(from, { type: "pong" });
      return state;
    },
    onTimer: (_c, s) => s,
  };
}

function makeCluster(): { sim: Simulation; net: Network; chaos: Chaos } {
  const net = new Network({ latency: constantLatency(10) });
  const sim = new Simulation({ seed: 1, transport: net });
  sim.addNode("a", echo());
  sim.addNode("b", echo());
  return { sim, net, chaos: new Chaos(sim, net) };
}

test("a scheduled partition isolates nodes only during its window", () => {
  const { sim, chaos } = makeCluster();
  const drops: Array<{ time: number; reason: string }> = [];
  const delivered: number[] = [];
  sim.subscribe((e: SimEvent) => {
    if (e.kind === "message:dropped") drops.push({ time: e.time, reason: e.reason });
    if (e.kind === "message:delivered") delivered.push(e.time);
  });

  chaos.partition(["a"], 100, 200); // a is isolated during [100, 300)

  sim.scheduleAt(50, () => sim.inject("b", { type: "ping" }, "a")); // before — delivered
  sim.scheduleAt(150, () => sim.inject("b", { type: "ping" }, "a")); // during — dropped
  sim.scheduleAt(400, () => sim.inject("b", { type: "ping" }, "a")); // after — delivered
  sim.run({ until: 1000 });

  assert.ok(
    drops.some((d) => d.reason === "partition" && d.time >= 100 && d.time < 300),
    "the message sent during the window should be dropped by the partition",
  );
  assert.ok(delivered.includes(60), "the pre-partition message arrives at t=60");
  assert.ok(
    delivered.some((t) => t >= 410),
    "traffic resumes after the partition heals",
  );
});

test("a scheduled crash window brings a node down then back up", () => {
  const { sim, chaos } = makeCluster();
  const crashedAt: number[] = [];
  const restartedAt: number[] = [];
  sim.subscribe((e) => {
    if (e.kind === "node:crashed") crashedAt.push(e.time);
    if (e.kind === "node:restarted") restartedAt.push(e.time);
  });

  chaos.crash("a", 500, 300);
  sim.run({ until: 2000 });

  assert.deepEqual(crashedAt, [500]);
  assert.deepEqual(restartedAt, [800]);
});

test("a loss window drops everything while active", () => {
  const { sim, net, chaos } = makeCluster();
  const drops: number[] = [];
  sim.subscribe((e) => {
    if (e.kind === "message:dropped" && e.reason === "loss") drops.push(e.time);
  });

  chaos.lossWindow(1, 100, 100); // 100% loss during [100, 200)

  sim.scheduleAt(150, () => sim.inject("b", { type: "ping" }, "a")); // dropped
  sim.scheduleAt(300, () => sim.inject("b", { type: "ping" }, "a")); // delivered
  sim.run({ until: 1000 });

  assert.ok(
    drops.some((t) => t >= 100 && t < 200),
    "message during the window is lost",
  );
  assert.equal(net.loss, 0, "loss rate is restored afterwards");
});

test("the chaos monkey crashes nodes repeatedly and deterministically", () => {
  const run = (): number[] => {
    const { sim, chaos } = makeCluster();
    const crashes: string[] = [];
    sim.subscribe((e) => {
      if (e.kind === "node:crashed") crashes.push(e.nodeId);
    });
    chaos.monkey({ seed: 7, interval: 500, downtime: 200, until: 3000 });
    sim.run({ until: 3500 });
    return crashes.map((id) => (id === "a" ? 0 : 1));
  };
  const first = run();
  assert.ok(first.length >= 3, "the monkey should strike multiple times");
  assert.deepEqual(first, run(), "the rampage is reproducible for a fixed seed");
});

test("chaos faults appear on the timeline as labelled actions", () => {
  const { sim, chaos } = makeCluster();
  const labels: string[] = [];
  sim.subscribe((e) => {
    if (e.kind === "action") labels.push(e.label);
  });
  chaos.partition(["a"], 100, 100);
  sim.run({ until: 1000 });
  assert.ok(labels.some((l) => l.startsWith("chaos: partition")));
  assert.ok(labels.some((l) => l.startsWith("chaos: heal")));
});
