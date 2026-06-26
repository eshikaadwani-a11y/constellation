import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../engine/simulation.js";
import { TopologyModel } from "../topology/model.js";
import type { Message, Protocol } from "../engine/index.js";
import { EventRecorder } from "./recorder.js";
import { computeMetrics } from "./metrics.js";
import { buildJournal } from "./logs.js";
import { buildTraces } from "./trace.js";

interface Ping extends Message {
  type: "ping";
  n: number;
}
interface Pong extends Message {
  type: "pong";
  n: number;
}

function pingPong(target: string | null, limit: number): Protocol<{ n: number }, Ping | Pong> {
  return {
    name: "ping-pong",
    init: (ctx) => {
      if (target) ctx.send(target, { type: "ping", n: 0 });
      return { n: 0 };
    },
    onMessage(ctx, state, from, message) {
      if (message.type === "ping") {
        ctx.send(from, { type: "pong", n: message.n });
        return state;
      }
      if (message.n < limit) ctx.send(from, { type: "ping", n: message.n + 1 });
      return { n: message.n };
    },
    onTimer: (_c, s) => s,
  };
}

function recordedPingPong(limit: number): EventRecorder {
  const sim = new Simulation({ seed: 1 });
  const rec = new EventRecorder();
  rec.attach(sim);
  sim.addNode("a", pingPong(null, limit));
  sim.addNode("b", pingPong(null, limit));
  sim.inject("b", { type: "ping", n: 0 }, "a");
  sim.run({ until: 100000 });
  return rec;
}

test("recorder captures the full ordered history", () => {
  const rec = recordedPingPong(3);
  const events = rec.all();
  assert.ok(events.length > 0);
  for (let i = 1; i < events.length; i++) {
    assert.ok((events[i] as { seq: number }).seq > (events[i - 1] as { seq: number }).seq);
  }
});

test("until() returns a deterministic time-travel prefix that re-folds", () => {
  const rec = recordedPingPong(5);
  const midpoint = Math.floor(rec.duration / 2);
  const model = new TopologyModel();
  for (const e of rec.until(midpoint)) model.apply(e);
  const snap = model.snapshot();
  // Re-folding a prefix yields a valid snapshot no later than the cut point.
  assert.ok(snap.time <= midpoint);
  assert.equal(snap.nodes.length, 2);
});

test("metrics totals match the raw event counts", () => {
  const rec = recordedPingPong(4);
  const events = rec.all();
  const metrics = computeMetrics(events, 10);
  const rawSent = events.filter((e) => e.kind === "message:sent").length;
  const rawDelivered = events.filter((e) => e.kind === "message:delivered").length;
  assert.equal(metrics.totals.sent, rawSent);
  assert.equal(metrics.totals.delivered, rawDelivered);
  assert.equal(metrics.deliveryRatio, 1); // lossless default transport
  assert.ok(metrics.buckets.length > 0);
});

test("journal records drops and crashes with severities", () => {
  const sim = new Simulation({ seed: 1 });
  const rec = new EventRecorder();
  rec.attach(sim);
  sim.addNode("a", pingPong(null, 9));
  sim.addNode("b", pingPong(null, 9));
  sim.crash("b");
  sim.inject("b", { type: "ping", n: 0 }, "a"); // will be dropped at b
  sim.run({ until: 1000 });

  const journal = buildJournal(rec.all());
  assert.ok(journal.some((e) => e.message.includes("node crashed") && e.level === "warn"));
  assert.ok(journal.some((e) => e.message.includes("dropped")));

  const warnings = buildJournal(rec.all(), { minLevel: "warn" });
  assert.ok(warnings.every((e) => e.level === "warn" || e.level === "error"));
});

test("traces reconstruct the causal chain of a request", () => {
  const rec = recordedPingPong(3);
  const forest = buildTraces(rec.all());
  // The single injected ping is the lone root; each reply is caused by the
  // previous delivery, so the chain is deep.
  assert.equal(forest.roots.length, 1);
  assert.ok(forest.maxDepth >= 3, `expected a deep causal chain, got ${forest.maxDepth}`);
  const root = forest.roots[0]!;
  assert.equal(root.type, "ping");
  assert.ok(root.children.length >= 1);
});

test("traces mark dropped messages", () => {
  const sim = new Simulation({ seed: 1 });
  const rec = new EventRecorder();
  rec.attach(sim);
  sim.addNode("a", pingPong(null, 0));
  sim.addNode("b", pingPong(null, 0));
  sim.crash("b");
  sim.inject("b", { type: "ping", n: 0 }, "a");
  sim.run({ until: 1000 });

  const forest = buildTraces(rec.all());
  assert.equal(forest.roots.length, 1);
  assert.equal(forest.roots[0]?.dropped, true);
});
