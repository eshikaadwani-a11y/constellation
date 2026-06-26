<div align="center">

# Constellation

### See distributed systems actually think.

An interactive laboratory for building, visualizing, and stress-testing distributed
systems — powered by a deterministic, replayable simulation engine.

`deterministic` · `replayable` · `pluggable protocols` · `chaos engineering` · `time-travel debugging`

</div>

---

## Why

Almost every backend engineer knows the _theory_ of distributed systems. Very few have ever
**watched one run** — seen a Raft election resolve, a network partition split a quorum, or a
retry storm cascade into collapse.

Constellation makes distributed systems observable. You build a cluster, press play, inject
failures, and watch the protocol fight to stay correct — packet by packet, event by event — with
the ability to scrub backwards through time and ask _why_.

It is not a dashboard and not an AI wrapper. It is an engineering instrument.

## The core idea: determinism

The heart of Constellation is a **deterministic discrete-event simulation engine**. There is no
wall clock and no real concurrency — instead, a virtual clock advances through an ordered queue of
events, and every source of randomness (message latency, packet loss, election timeouts) is drawn
from a single seeded generator.

The consequence is powerful:

> An entire simulation — every message, every failure, every outcome — is a pure function of one
> 32-bit seed and a scenario definition.

That is what makes runs **perfectly reproducible**, **replayable**, and amenable to **time-travel
debugging**. The same seed always produces the same history, so a bug seen once can be replayed
forever.

The engine is also **isomorphic**: it has zero dependencies and no reliance on the DOM or Node, so
the exact same TypeScript powers the in-browser laboratory and the Node test suite.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Browser UI  (React · React Flow · ECharts · Monaco)           │
│  topology canvas · telemetry · timeline scrubber · editor      │
└───────────────────────────────┬──────────────────────────────┘
                                 │  consumes (read-only view + commands)
┌───────────────────────────────▼──────────────────────────────┐
│  @constellation/engine   (pure TypeScript, zero dependencies)  │
│                                                                │
│   core/        deterministic RNG · min-heap scheduler · ids    │
│   engine/      virtual clock · event queue · node runtime      │
│   network/     latency · loss · reordering · partitions        │
│   protocols/   Raft · gossip · vector clocks · …  (pluggable)  │
│   chaos/       fault injection scheduled into the timeline     │
│   observability/  metrics · structured logs · traces · replay  │
└────────────────────────────────────────────────────────────────┘
```

The engine is designed as a **framework, not a demo**: a protocol is a small plugin that reacts to
messages and timers through a narrow `NodeContext` API. Adding a new distributed algorithm does not
require touching the engine.

See [`docs/architecture.md`](docs/architecture.md) for the full design.

## Status

Constellation is being built in the open, milestone by milestone.

| Area                        | Status         |
| --------------------------- | -------------- |
| Core primitives (RNG, heap) | ✅ Implemented |
| Simulation engine           | ✅ Implemented |
| Topology visualization      | ✅ Implemented |
| Networking layer            | ✅ Implemented |
| Raft consensus              | ✅ Implemented |
| Observability & replay      | ✅ Implemented |
| Chaos engineering           | ✅ Implemented |
| Scalability                 | ✅ Implemented |
| Intelligent tutor           | ✅ Implemented |
| Protocol library            | ✅ Implemented |
| Cloud orchestration         | ✅ Implemented |
| Persistence & versioning    | ✅ Implemented |
| Production infrastructure   | ⏳ Next        |

**Persistence is built on reproducibility.** Since a run is a pure function of its inputs, a project
saves as a tiny **declarative scenario spec** — seed, nodes (by protocol name, via a **protocol
registry**), network config, and a schedule of client requests and faults — and reloading it
reproduces the run bit-for-bit (verified by test). The recorded event stream can be **exported and
re-imported** as JSON for offline analysis. In the lab, projects save to local storage with a
version history, and any run exports to a portable event log.

**Cloud orchestration.** A Kubernetes-style control plane built from engine protocols: a pure,
tested bin-packing **scheduler**; **kubelets** that heartbeat capacity and run assigned pods; a
**control plane** that reconciles desired state, bin-packs pods, and detects dead machines by missed
heartbeats — rescheduling their pods; and a **horizontal autoscaler**. Crash a machine and the
control plane notices the silence and reschedules, all on the deterministic timeline. See
[`docs/cloud.md`](docs/cloud.md).

**Protocol library.** Beyond Raft, the engine ships four primitives a backend engineer actually
reaches for: **vector clocks** (causality / conflict detection), **consistent hashing** (sharding and
CDN routing, with virtual nodes and minimal-remap verified), **epidemic gossip** (anti-entropy
dissemination), and **two-phase commit** — which also demonstrates 2PC's real-world weakness: crash
the coordinator mid-transaction and watch participants block, a property the tests prove. Every one
is a plugin behind the `Protocol` interface; the engine needs no changes to run a new algorithm. See
[`docs/protocols.md`](docs/protocols.md) for a complete `class MyProtocol implements Protocol`
example.

**The systems tutor** is a deterministic reasoning engine — deliberately _not_ an LLM wrapper. It
analyzes the recorded event stream and explains, causally, why the system behaved as it did: why a
node won an election (with the vote count and the majority it cleared), when an entry became durable,
why a leader crash is critical, and how a partition stalls the minority side (the CAP theorem, live).
Explanations are pure, reproducible, and unit-tested. The lab surfaces them in a **Tutor** panel
(click to jump the timeline) and as per-node "why is this node doing that?" notes in the inspector.

The deterministic **simulation engine** is implemented and tested: a virtual-clock, event-driven
scheduler with a pluggable protocol contract, per-node deterministic RNG streams, an observable
event stream, and crash/restart support. Defining a distributed algorithm means writing one small
`Protocol`:

```ts
import { Simulation, type Protocol, type Message } from "@constellation/engine";

interface Ping extends Message {
  type: "ping";
  n: number;
}
interface Pong extends Message {
  type: "pong";
  n: number;
}

const pingPong = (
  target: string | null,
  limit: number,
): Protocol<{ rounds: number }, Ping | Pong> => ({
  name: "ping-pong",
  init: (ctx) => (target && ctx.send(target, { type: "ping", n: 0 }), { rounds: 0 }),
  onMessage(ctx, state, from, msg) {
    if (msg.type === "ping") return (ctx.send(from, { type: "pong", n: msg.n }), state);
    if (msg.n < limit) ctx.send(from, { type: "ping", n: msg.n + 1 });
    return { rounds: state.rounds + 1 };
  },
  onTimer: (_ctx, state) => state,
});

const sim = new Simulation({ seed: 42 });
sim.subscribe((event) => console.log(event.time, event.kind)); // observe everything
sim.addNode("a", pingPong("b", 8));
sim.addNode("b", pingPong(null, 8));
sim.run({ until: 10_000 }); // deterministic: identical on every run
```

Every `send`, `setTimer`, delivery, drop, and log surfaces on the engine's event stream — the
substrate the visualization and observability milestones build on.

## Quick start

Constellation has **no runtime dependencies** in its engine and uses no bundler. You need only
Node 22+.

```bash
git clone https://github.com/eshikaadwani-a11y/constellation.git
cd constellation

npm run build     # compile the engine and the UI with tsc
npm test          # run the engine test suite (node --test)
npm run lint      # prettier + strict type-check
npm run dev       # build, then serve the lab at http://127.0.0.1:4173
```

> **A note on the UI stack.** The browser app uses React, React Flow, ECharts, and Monaco, loaded
> as native ES modules via an [import map](public/app.html) from a CDN — so there is nothing to
> install. In an environment with package-registry access you can switch to a standard Vite build
> without changing any component code.

## Engineering philosophy

- **The engine is the product.** The UI exists to explain and visualize it.
- **Determinism over everything.** If it can't be replayed, it isn't done.
- **A framework, not a demo.** New protocols plug in; the core stays small.
- **No unnecessary complexity, no unnecessary dependencies** — but the right tool for each job.
- **Everything works.** No placeholders, no faked outputs.

## License

[MIT](LICENSE) © Constellation contributors
