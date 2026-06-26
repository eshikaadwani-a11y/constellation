#!/usr/bin/env node
// Engine throughput benchmark. Zero dependencies; runs the compiled engine.
//
// Usage: npm run build:engine && node scripts/bench.mjs
import { Simulation, Network, uniformLatency } from "../dist/index.js";

function chatter() {
  return {
    name: "chatter",
    init(ctx) {
      ctx.setTimer(ctx.randomInt(20, 60), "tick");
      return null;
    },
    onMessage: (_c, s) => s,
    onTimer(ctx, s) {
      ctx.setTimer(ctx.randomInt(20, 60), "tick");
      if (ctx.peers.length > 0) {
        ctx.send(ctx.peers[ctx.randomInt(0, ctx.peers.length - 1)], { type: "rumor" });
      }
      return s;
    },
  };
}

function bench(nodes, virtualMs) {
  const sim = new Simulation({
    seed: 1,
    transport: new Network({ latency: uniformLatency(5, 30) }),
  });
  for (let i = 0; i < nodes; i++) sim.addNode(`n${i + 1}`, chatter());
  const start = process.hrtime.bigint();
  const result = sim.run({ until: virtualMs, maxSteps: 100_000_000 });
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  return { nodes, ...result, events: sim.eventCount, elapsedMs };
}

console.log("Constellation engine benchmark\n");
console.log(
  ["nodes", "steps", "events", "wall(ms)", "events/sec", "virtual×realtime"]
    .map((s) => s.padStart(16))
    .join(""),
);

for (const nodes of [10, 50, 100, 250, 500]) {
  const r = bench(nodes, 5000);
  const eventsPerSec = Math.round((r.events / r.elapsedMs) * 1000);
  const speedup = Math.round(r.now / r.elapsedMs);
  console.log(
    [
      String(r.nodes),
      r.steps.toLocaleString(),
      r.events.toLocaleString(),
      r.elapsedMs.toFixed(1),
      eventsPerSec.toLocaleString(),
      `${speedup.toLocaleString()}×`,
    ]
      .map((s) => s.padStart(16))
      .join(""),
  );
}
