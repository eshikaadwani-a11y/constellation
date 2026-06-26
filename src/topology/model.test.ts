import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../engine/simulation.js";
import { FixedLatencyTransport } from "../engine/transport.js";
import type { Message, Protocol } from "../engine/index.js";
import { TopologyModel } from "./model.js";

interface Ping extends Message {
  type: "ping";
  n: number;
}
interface Pong extends Message {
  type: "pong";
  n: number;
}

function pingPong(target: string | null, limit: number): Protocol<{ rounds: number }, Ping | Pong> {
  return {
    name: "ping-pong",
    init: (ctx) => {
      if (target) ctx.send(target, { type: "ping", n: 0 });
      return { rounds: 0 };
    },
    onMessage(ctx, state, from, message) {
      if (message.type === "ping") {
        ctx.send(from, { type: "pong", n: message.n });
        return state;
      }
      if (message.n < limit) ctx.send(from, { type: "ping", n: message.n + 1 });
      return { rounds: state.rounds + 1 };
    },
    onTimer: (_c, s) => s,
  };
}

test("model tracks nodes added to the cluster", () => {
  const sim = new Simulation({ seed: 1 });
  const model = new TopologyModel();
  model.attach(sim);
  sim.addNode("a", pingPong(null, 0));
  sim.addNode("b", pingPong(null, 0));
  const snap = model.snapshot();
  assert.deepEqual(snap.nodes.map((n) => n.id).sort(), ["a", "b"]);
  assert.equal(
    snap.nodes.every((n) => n.status === "up"),
    true,
  );
});

test("model records links and message counts", () => {
  const sim = new Simulation({ seed: 1 });
  const model = new TopologyModel();
  model.attach(sim);
  sim.addNode("a", pingPong("b", 2));
  sim.addNode("b", pingPong(null, 2));
  sim.run({ until: 1000 });

  const snap = model.snapshot();
  const ab = snap.links.find((l) => l.id === "a->b");
  const ba = snap.links.find((l) => l.id === "b->a");
  assert.ok(ab && ab.messages >= 1, "a->b link exists");
  assert.ok(ba && ba.messages >= 1, "b->a link exists");
  assert.ok(snap.delivered > 0);
});

test("in-flight messages appear then resolve", () => {
  // 100ms latency keeps a message in flight long enough to observe mid-run.
  const sim = new Simulation({ seed: 1, transport: new FixedLatencyTransport(100) });
  const model = new TopologyModel();
  model.attach(sim);
  sim.addNode("a", pingPong(null, 0));
  sim.addNode("b", pingPong(null, 0));
  // Both nodes exist before any traffic, then a ping is injected from a to b.
  sim.inject("b", { type: "ping", n: 0 }, "a");

  sim.run({ until: 50 }); // ping sent at t=0, arrives t=100 — still in flight
  const mid = model.snapshot();
  assert.equal(mid.inFlight.length, 1);
  const msg = mid.inFlight[0]!;
  assert.equal(msg.from, "a");
  assert.equal(msg.to, "b");
  assert.equal(msg.deliverAt, 100);

  sim.run({ until: 1000 });
  assert.equal(model.snapshot().inFlight.length, 0);
});

test("crashed nodes show as down and their deliveries drop", () => {
  const sim = new Simulation({ seed: 1 });
  const model = new TopologyModel();
  model.attach(sim);
  sim.addNode("a", pingPong("b", 5));
  sim.addNode("b", pingPong(null, 5));
  sim.crash("b");
  sim.run({ until: 1000 });

  const snap = model.snapshot();
  assert.equal(snap.nodes.find((n) => n.id === "b")?.status, "down");
  assert.ok(snap.dropped > 0);
  assert.equal(snap.inFlight.length, 0); // dropped messages are removed from flight
});

test("snapshots are detached copies", () => {
  const sim = new Simulation({ seed: 1 });
  const model = new TopologyModel();
  model.attach(sim);
  sim.addNode("a", pingPong(null, 0));
  const first = model.snapshot();
  sim.addNode("b", pingPong(null, 0));
  // The earlier snapshot must not retroactively gain node "b".
  assert.equal(first.nodes.length, 1);
});
