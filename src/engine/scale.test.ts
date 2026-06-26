import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "./simulation.js";
import { Network } from "../network/network.js";
import { uniformLatency } from "../network/latency.js";
import { TopologyModel } from "../topology/model.js";
import type { Message, NodeId, Protocol } from "./index.js";

/** A gossip node that periodically pushes a counter to a random peer. */
function chatter(): Protocol<{ ticks: number }, Message> {
  return {
    name: "chatter",
    init(ctx) {
      ctx.setTimer(ctx.randomInt(20, 60), "tick");
      return { ticks: 0 };
    },
    onMessage: (_c, s) => s,
    onTimer(ctx, state) {
      ctx.setTimer(ctx.randomInt(20, 60), "tick");
      if (ctx.peers.length > 0) {
        ctx.send(ctx.peers[ctx.randomInt(0, ctx.peers.length - 1)] as NodeId, { type: "rumor" });
      }
      return { ticks: state.ticks + 1 };
    },
  };
}

test("a large cluster runs deterministically and stays consistent", () => {
  const build = (): { events: number; topoNodes: number } => {
    const sim = new Simulation({
      seed: 99,
      transport: new Network({ latency: uniformLatency(5, 30) }),
    });
    const model = new TopologyModel();
    model.attach(sim);
    for (let i = 0; i < 200; i++) sim.addNode(`n${i + 1}`, chatter());
    sim.run({ until: 3000 });
    return { events: sim.eventCount, topoNodes: model.snapshot().nodes.length };
  };

  const a = build();
  const b = build();
  assert.equal(a.events, b.events, "200-node run must be reproducible");
  assert.equal(a.topoNodes, 200);
  assert.ok(a.events > 50000, `expected a substantial event count, got ${a.events}`);
});

test("the scheduler processes a heavy run within a bounded step budget", () => {
  const sim = new Simulation({ seed: 1 });
  for (let i = 0; i < 100; i++) sim.addNode(`n${i + 1}`, chatter());
  const result = sim.run({ until: 5000, maxSteps: 1_000_000 });
  assert.ok(result.steps > 0);
  assert.ok(result.steps < 1_000_000, "the run should complete well within the safety budget");
  assert.equal(result.now, 5000);
});
