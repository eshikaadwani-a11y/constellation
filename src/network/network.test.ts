import { test } from "node:test";
import assert from "node:assert/strict";
import { Random } from "../core/prng.js";
import { Simulation } from "../engine/simulation.js";
import type { Envelope, Message, NodeId, Protocol } from "../engine/index.js";
import { Network } from "./network.js";
import { constantLatency, exponentialLatency, uniformLatency } from "./latency.js";

const envelope = (from: NodeId, to: NodeId): Envelope => ({
  id: 1,
  from,
  to,
  message: { type: "x" },
  sentAt: 0,
});

test("latency models draw deterministically from the stream", () => {
  const model = uniformLatency(10, 50);
  const a = new Random(5);
  const b = new Random(5);
  for (let i = 0; i < 100; i++) assert.equal(model.sample(a), model.sample(b));
});

test("exponential latency is always non-negative", () => {
  const model = exponentialLatency(20);
  const rng = new Random(9);
  for (let i = 0; i < 1000; i++) assert.ok(model.sample(rng) >= 0);
});

test("loss rate converges to the configured probability", () => {
  const net = new Network({ lossRate: 0.25 });
  const rng = new Random(2024);
  let dropped = 0;
  const trials = 50000;
  for (let i = 0; i < trials; i++) {
    if (!net.route(envelope("a", "b"), rng, 0).deliver) dropped++;
  }
  assert.ok(Math.abs(dropped / trials - 0.25) < 0.01, `drop ratio ${dropped / trials}`);
});

test("a partition blocks cross-side traffic but not intra-side", () => {
  const net = new Network();
  net.partition(["a", "b"]); // {a,b} | {c,d}
  const rng = new Random(1);
  assert.equal(net.route(envelope("a", "c"), rng, 0).deliver, false); // crosses
  assert.equal(net.route(envelope("a", "b"), rng, 0).deliver, true); // within side
  assert.equal(net.route(envelope("c", "d"), rng, 0).deliver, true); // within complement
});

test("partitions respect their time window", () => {
  const net = new Network();
  net.partition(["a"], { start: 100, end: 200 });
  const rng = new Random(1);
  assert.equal(net.route(envelope("a", "b"), rng, 50).deliver, true); // before
  assert.equal(net.route(envelope("a", "b"), rng, 150).deliver, false); // during
  assert.equal(net.route(envelope("a", "b"), rng, 250).deliver, true); // after
});

test("heal removes a partition and reconnects the cluster", () => {
  const net = new Network();
  const id = net.partition(["a"]);
  const rng = new Random(1);
  assert.equal(net.route(envelope("a", "b"), rng, 0).deliver, false);
  assert.equal(net.heal(id), true);
  assert.equal(net.route(envelope("a", "b"), rng, 0).deliver, true);
  assert.equal(net.partitionCount, 0);
});

test("constant latency drives exact delivery times in a run", () => {
  const sim = new Simulation({ seed: 1, transport: new Network({ latency: constantLatency(25) }) });
  const delivered: number[] = [];
  sim.subscribe((e) => {
    if (e.kind === "message:delivered") delivered.push(e.time);
  });
  const noop: Protocol<null, Message> = {
    name: "noop",
    init: () => null,
    onMessage: (_c, s) => s,
    onTimer: (_c, s) => s,
  };
  sim.addNode("a", noop);
  sim.addNode("b", noop);
  sim.inject("b", { type: "hi" }, "a");
  sim.run({ until: 1000 });
  assert.deepEqual(delivered, [25]);
});

// --- Retries over a lossy link --------------------------------------------

interface Data extends Message {
  type: "data";
  payload: number;
}
interface Ack extends Message {
  type: "ack";
  payload: number;
}

interface SenderState {
  acked: boolean;
  attempts: number;
}

/** Reliable sender: resends on a timeout until it receives an ack. */
function reliableSender(
  target: NodeId,
  payload: number,
  timeout: number,
): Protocol<SenderState, Data | Ack> {
  return {
    name: "reliable-sender",
    init(ctx) {
      ctx.send(target, { type: "data", payload });
      ctx.setTimer(timeout, "retry");
      return { acked: false, attempts: 1 };
    },
    onMessage(_ctx, state, _from, message) {
      if (message.type === "ack" && message.payload === payload) return { ...state, acked: true };
      return state;
    },
    onTimer(ctx, state, token) {
      if (token !== "retry" || state.acked) return state;
      ctx.send(target, { type: "data", payload });
      ctx.setTimer(timeout, "retry");
      return { ...state, attempts: state.attempts + 1 };
    },
  };
}

function ackingReceiver(): Protocol<null, Data | Ack> {
  return {
    name: "acking-receiver",
    init: () => null,
    onMessage(ctx, state, from, message) {
      if (message.type === "data") ctx.send(from, { type: "ack", payload: message.payload });
      return state;
    },
    onTimer: (_c, s) => s,
  };
}

test("a reliable protocol eventually delivers across a very lossy network", () => {
  const sim = new Simulation({
    seed: 7,
    transport: new Network({ latency: constantLatency(10), lossRate: 0.6 }),
  });
  sim.addNode("sender", reliableSender("receiver", 99, 50));
  sim.addNode("receiver", ackingReceiver());
  sim.run({ until: 100000 });

  const state = sim.stateOf<SenderState>("sender");
  assert.equal(state?.acked, true, "sender should eventually receive an ack");
  assert.ok((state?.attempts ?? 0) > 1, "retries should have been necessary on a 60% loss link");
});
