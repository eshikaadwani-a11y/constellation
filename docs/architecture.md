# Architecture

This document describes how Constellation is designed. It is the reference the implementation
follows as it grows milestone by milestone.

## Design goals

1. **Determinism.** Every run is a pure function of `(seed, scenario)`. No wall clock, no real
   threads, no nondeterministic iteration order.
2. **Reproducibility & replay.** Because runs are deterministic, any history can be replayed
   exactly, and any moment can be revisited — the foundation for time-travel debugging.
3. **A framework, not a demo.** Protocols are plugins behind a narrow interface. The engine never
   needs to know which algorithm it is running.
4. **Isomorphism.** The engine is pure TypeScript with zero dependencies and no DOM/Node coupling,
   so the same code runs in the browser and under `node --test`.
5. **Observability as a first-class output.** The engine emits a structured event stream that the
   UI turns into metrics, logs, traces, and a scrubable timeline.

## The simulation model

Constellation is a **discrete-event simulator**. Rather than advancing time in fixed ticks, it
maintains a priority queue of pending events ordered by virtual timestamp and processes them one at
a time, jumping the virtual clock forward to each event in turn.

```
while queue not empty and clock < horizon:
    event = queue.popMin()          # earliest (time, seq)
    clock = event.time              # virtual time only ever moves forward
    dispatch(event)                 # may enqueue new future events
```

Key properties:

- **Virtual time.** The clock is an integer count of virtual milliseconds. A 10-minute simulation
  runs in microseconds of real time; a microsecond-level interaction can be inspected at leisure.
- **Total order.** Events are ordered by `(time, sequence)`. The monotonically increasing sequence
  number breaks ties in insertion order, which removes the last source of nondeterminism.
- **No concurrency.** "Concurrent" nodes are modelled as interleaved events. This is exactly how
  real reasoning about distributed systems works — and it is what makes the system analyzable.

The priority queue is a binary [`MinHeap`](../src/core/heap.ts); the clock and queue together form
the scheduler (milestone 2).

## Determinism: the seeded generator

All randomness flows from a single [`Random`](../src/core/prng.ts) instance seeded once per run.
It is a `mulberry32` generator seeded through `splitmix32`, providing:

- uniform floats and integers,
- Bernoulli trials (packet loss),
- exponential and normal distributions (latency and jitter),
- shuffles and weighted choice,
- **snapshot/restore** of internal state, so a run can be paused and resumed bit-for-bit.

Sub-components derive independent streams via `fork()`, so adding a new randomized feature never
perturbs the streams other components already depend on — a subtle but critical property for keeping
historical seeds reproducible as the engine evolves.

## Nodes and the protocol plugin contract

A **node** is an actor with private state. It never touches the scheduler, the clock, or other
nodes directly. Instead it acts through a `NodeContext` the engine hands it:

```ts
interface NodeContext {
  readonly id: NodeId;
  readonly now: number; // current virtual time
  send(to: NodeId, message: Message): void; // hand a message to the network
  broadcast(message: Message): void;
  setTimer(delay: number, token: string): TimerId; // schedule a future wake-up
  clearTimer(id: TimerId): void;
  random(): number; // deterministic, drawn from the node's stream
  log(level: LogLevel, event: string, fields?: Record<string, unknown>): void;
}
```

A **protocol** is the plugin that defines behaviour. It is a pure reducer over inputs:

```ts
interface Protocol<S> {
  init(ctx: NodeContext): S;
  onMessage(ctx: NodeContext, state: S, message: Message): S;
  onTimer(ctx: NodeContext, state: S, token: string): S;
}
```

Because a protocol only ever reacts to `onMessage`/`onTimer` and expresses side effects through
`ctx`, the engine can record every input and output, replay them, and visualize them — without the
protocol knowing any of that is happening. Raft, gossip, vector clocks, and consistent hashing are
all just different `Protocol` implementations.

## The network layer

Messages do not travel instantly. The network (milestone 4) sits between `ctx.send` and the
recipient's `onMessage`, and models reality deterministically:

- **Latency** — sampled per link from a configurable distribution.
- **Loss** — a Bernoulli trial per message.
- **Reordering** — a natural consequence of per-message latency.
- **Partitions** — links that drop all traffic for a scheduled window.

Every effect is drawn from the seeded generator, so the network is as reproducible as the protocols
running on top of it.

## Chaos engineering

Faults (milestone 7) are scheduled events like any other: a partition, a node crash, or a latency
spike is just an event placed on the timeline at a virtual time. This unifies "the system doing its
thing" and "the operator breaking things" into one ordered, replayable history.

## Observability and replay

The engine emits a typed event stream — message sent/delivered/dropped, timer fired, state
transition, log line. This stream is the single source of truth for:

- **Metrics** — derived by folding over events (messages/sec, election count, commit latency).
- **Logs** — structured, queryable, and tied to a virtual timestamp.
- **Traces** — causal chains reconstructed from message lineage.
- **Replay & time travel** — because the run is deterministic, the UI can reconstruct exact state
  at any past timestamp by replaying from the last snapshot.

## Why the UI is a separate layer

The engine produces data; the UI renders it. They are deliberately decoupled:

- The engine is pure and headless — it is tested without a browser.
- The UI (React + React Flow for topology, ECharts for telemetry, Monaco for protocol editing) is a
  read-only view plus a command channel. It can be swapped or embedded without touching the engine.

This separation is what lets the most interesting part of the project — the engine — be developed,
tested, and reasoned about as a standalone framework.

## Repository layout

```
src/                 @constellation/engine — pure, isomorphic, zero-dependency
  core/              deterministic RNG, min-heap scheduler primitive
  engine/            virtual clock, event queue, node runtime        (milestone 2)
  network/           latency, loss, partitions                       (milestone 4)
  protocols/         Raft, gossip, …                                 (milestone 5+)
  chaos/             fault injection                                 (milestone 7)
  observability/     metrics, logs, traces, replay                   (milestone 6)
web/                 React UI (loaded via import map, compiled by tsc)
public/              static assets, landing page, lab shell
scripts/             zero-dependency build/serve helpers
docs/                this document and guides
```
