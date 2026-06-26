import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "./simulation.js";
import { FixedLatencyTransport } from "./transport.js";
import type { Message, Protocol, SimEvent } from "./index.js";

// ---------------------------------------------------------------------------
// Example protocols used to exercise the engine.
// ---------------------------------------------------------------------------

interface Ping extends Message {
  type: "ping";
  n: number;
}
interface Pong extends Message {
  type: "pong";
  n: number;
}
type PingPongMsg = Ping | Pong;

interface PingPongState {
  pings: number;
  pongs: number;
}

/** Bounces a counter back and forth until `limit` round-trips complete. */
function pingPong(target: string | null, limit: number): Protocol<PingPongState, PingPongMsg> {
  return {
    name: "ping-pong",
    init(ctx) {
      if (target) ctx.send(target, { type: "ping", n: 0 });
      return { pings: 0, pongs: 0 };
    },
    onMessage(ctx, state, from, message) {
      if (message.type === "ping") {
        ctx.send(from, { type: "pong", n: message.n });
        return { ...state, pings: state.pings + 1 };
      }
      if (message.n < limit) ctx.send(from, { type: "ping", n: message.n + 1 });
      return { ...state, pongs: state.pongs + 1 };
    },
    onTimer(_ctx, state) {
      return state;
    },
  };
}

interface BeaconState {
  ticks: number;
}

/** Re-arms a randomized timer forever, counting ticks. Tests RNG determinism. */
function beacon(): Protocol<BeaconState, Message> {
  return {
    name: "beacon",
    init(ctx) {
      ctx.setTimer(ctx.randomInt(10, 50), "tick");
      return { ticks: 0 };
    },
    onMessage(_ctx, state) {
      return state;
    },
    onTimer(ctx, state) {
      ctx.log("info", "tick", { at: ctx.now });
      ctx.setTimer(ctx.randomInt(10, 50), "tick");
      return { ticks: state.ticks + 1 };
    },
  };
}

function fingerprint(events: SimEvent[]): string {
  return events.map((e) => `${e.seq}:${e.kind}@${e.time}`).join("|");
}

// ---------------------------------------------------------------------------

test("ping-pong exchanges messages until the limit", () => {
  const sim = new Simulation({ seed: 1 });
  sim.addNode("a", pingPong("b", 3));
  sim.addNode("b", pingPong(null, 3));
  const result = sim.run({ until: 1000 });

  assert.ok(result.steps > 0);
  const a = sim.stateOf<PingPongState>("a");
  const b = sim.stateOf<PingPongState>("b");
  // a sends ping0; b pongs; a pings1; ... up to n=3 then stops.
  assert.equal(b?.pings, 4); // pings n=0..3 received by b
  assert.equal(a?.pongs, 4);
});

test("same seed produces an identical event stream", () => {
  const trace = (): SimEvent[] => {
    const sim = new Simulation({ seed: 7 });
    const events: SimEvent[] = [];
    sim.subscribe((e) => events.push(e));
    sim.addNode("x", beacon());
    sim.addNode("y", beacon());
    sim.run({ until: 500 });
    return events;
  };
  assert.equal(fingerprint(trace()), fingerprint(trace()));
});

test("different seeds diverge", () => {
  const trace = (seed: number): string => {
    const sim = new Simulation({ seed });
    const events: SimEvent[] = [];
    sim.subscribe((e) => events.push(e));
    sim.addNode("x", beacon());
    sim.run({ until: 500 });
    return fingerprint(events);
  };
  assert.notEqual(trace(1), trace(2));
});

test("broadcast reaches every peer but not the sender", () => {
  const counts = new Map<string, number>();
  const proto: Protocol<null, Message> = {
    name: "bc",
    init: () => null,
    onMessage(ctx, state, _from, message) {
      if (message.type === "go") {
        ctx.broadcast({ type: "hello" });
      } else {
        counts.set(ctx.id, (counts.get(ctx.id) ?? 0) + 1);
      }
      return state;
    },
    onTimer: (_c, s) => s,
  };
  const sim = new Simulation({ seed: 1 });
  sim.addNode("a", proto);
  sim.addNode("b", proto);
  sim.addNode("c", proto);
  // Trigger the broadcast only after every node exists.
  sim.schedule(0, () => sim.inject("a", { type: "go" }, "client"));
  sim.run({ until: 100 });
  assert.equal(counts.get("b"), 1);
  assert.equal(counts.get("c"), 1);
  assert.equal(counts.get("a"), undefined); // the sender excludes itself
});

test("timers fire, and cleared timers do not", () => {
  const events: string[] = [];
  const proto: Protocol<null, Message> = {
    name: "timers",
    init(ctx) {
      const keep = ctx.setTimer(20, "keep");
      const cancel = ctx.setTimer(10, "cancel");
      ctx.clearTimer(cancel);
      void keep;
      return null;
    },
    onMessage: (_c, s) => s,
    onTimer(_ctx, state, token) {
      events.push(token);
      return state;
    },
  };
  const sim = new Simulation({ seed: 1 });
  sim.addNode("t", proto);
  sim.run({ until: 100 });
  assert.deepEqual(events, ["keep"]);
});

test("messages to a crashed node are dropped", () => {
  const dropped: string[] = [];
  const sim = new Simulation({ seed: 1 });
  sim.subscribe((e) => {
    if (e.kind === "message:dropped") dropped.push(e.reason);
  });
  sim.addNode("a", pingPong("b", 5));
  sim.addNode("b", pingPong(null, 5));
  sim.crash("b");
  sim.run({ until: 1000 });
  assert.ok(dropped.includes("node-crashed"));
  assert.equal(sim.stateOf<PingPongState>("b")?.pings, 0);
});

test("run(until) advances the clock even when idle", () => {
  const sim = new Simulation({ seed: 1 });
  sim.addNode("a", pingPong(null, 0));
  const result = sim.run({ until: 5000 });
  assert.equal(result.now, 5000);
  assert.equal(sim.now, 5000);
  assert.ok(result.idle);
});

test("step() processes exactly one task at a time", () => {
  const sim = new Simulation({ seed: 1 });
  sim.addNode("a", beacon());
  const before = sim.eventCount;
  const progressed = sim.step();
  assert.equal(progressed, true);
  assert.ok(sim.eventCount > before);
});

test("maxSteps bounds a run", () => {
  const sim = new Simulation({ seed: 1 });
  sim.addNode("a", beacon());
  sim.addNode("b", beacon());
  const result = sim.run({ until: 100000, maxSteps: 5 });
  assert.equal(result.steps, 5);
  assert.equal(result.idle, false);
});

test("custom transport latency is respected", () => {
  const delivered: number[] = [];
  const sim = new Simulation({ seed: 1, transport: new FixedLatencyTransport(42) });
  sim.subscribe((e) => {
    if (e.kind === "message:delivered") delivered.push(e.time);
  });
  sim.addNode("a", pingPong("b", 0));
  sim.addNode("b", pingPong(null, 0));
  sim.run({ until: 1000 });
  // First delivery (a's ping to b) happens at t = 42.
  assert.equal(delivered[0], 42);
});

test("duplicate node ids are rejected", () => {
  const sim = new Simulation({ seed: 1 });
  sim.addNode("a", pingPong(null, 0));
  assert.throws(() => sim.addNode("a", pingPong(null, 0)));
});
