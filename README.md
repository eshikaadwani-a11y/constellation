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
| Simulation engine           | 🚧 Next        |
| Topology visualization      | ⏳ Planned     |
| Networking layer            | ⏳ Planned     |
| Raft consensus              | ⏳ Planned     |
| Observability & replay      | ⏳ Planned     |
| Chaos engineering           | ⏳ Planned     |
| Additional protocols        | ⏳ Planned     |

Today the repository ships the deterministic foundation the rest of the engine is built on: a
seeded PRNG with reproducible streams and statistical distributions, and an allocation-light
priority queue — both fully unit-tested.

```ts
import { Random, MinHeap } from "@constellation/engine";

const rng = new Random(42);
rng.exponential(20); // latency sample, mean 20ms — identical for every run on seed 42

// The scheduler orders events by (time, sequence) so ties break deterministically.
const queue = new MinHeap<{ time: number; seq: number }>(
  (a, b) => a.time - b.time || a.seq - b.seq,
);
```

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
