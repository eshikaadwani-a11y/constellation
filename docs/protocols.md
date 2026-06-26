# Writing a protocol

Constellation's engine is a framework: a distributed algorithm is a plugin that implements one
interface, and the engine never needs to change to run it. This guide shows the whole contract and a
complete custom protocol.

## The contract

```ts
interface Protocol<S, M extends Message> {
  readonly name: string;
  init(ctx: NodeContext<M>): S;
  onMessage(ctx: NodeContext<M>, state: S, from: NodeId, message: M): S;
  onTimer(ctx: NodeContext<M>, state: S, token: string): S;
}
```

A protocol is a **pure reducer** over inputs. It never touches the scheduler, the clock, or other
nodes directly — every side effect goes through the `NodeContext`:

```ts
interface NodeContext<M extends Message> {
  readonly id: NodeId;
  readonly now: SimTime;
  readonly peers: readonly NodeId[];
  send(to: NodeId, message: M): void;
  broadcast(message: M): void;
  setTimer(delay: SimTime, token: string): TimerId;
  clearTimer(id: TimerId): void;
  random(): number; // deterministic, from this node's stream
  randomInt(min: number, max: number): number;
  log(level: LogLevel, message: string, fields?: Record<string, unknown>): void;
}
```

Because behaviour is expressed only through `ctx`, the engine can record, replay, and visualize every
run for free — and your protocol automatically gets the inspector (internal state), the event
timeline, metrics, traces, and time-travel debugging that every other protocol has.

## A complete example, as a class

The interface can be implemented by a plain object or a class. Here is a bully-style leader election
written as `class implements Protocol`, ready to run unchanged:

```ts
import {
  Simulation,
  type Message,
  type NodeContext,
  type NodeId,
  type Protocol,
} from "@constellation/engine";

interface Election extends Message {
  type: "election";
  from: NodeId;
}
interface Coordinator extends Message {
  type: "coordinator";
  leader: NodeId;
}
type BullyMessage = Election | Coordinator;

interface BullyState {
  leader: NodeId | null;
}

class Bully implements Protocol<BullyState, BullyMessage> {
  readonly name = "bully";

  init(ctx: NodeContext<BullyMessage>): BullyState {
    // The highest id wins; lower ids kick off an election after a short delay.
    ctx.setTimer(ctx.randomInt(50, 150), "start");
    return { leader: null };
  }

  onTimer(ctx: NodeContext<BullyMessage>, state: BullyState): BullyState {
    const higher = ctx.peers.filter((p) => p > ctx.id);
    if (higher.length === 0) {
      ctx.broadcast({ type: "coordinator", leader: ctx.id });
      return { leader: ctx.id };
    }
    for (const p of higher) ctx.send(p, { type: "election", from: ctx.id });
    return state;
  }

  onMessage(
    ctx: NodeContext<BullyMessage>,
    state: BullyState,
    _from: NodeId,
    message: BullyMessage,
  ): BullyState {
    if (message.type === "coordinator") return { leader: message.leader };
    // Got an "election" from a lower id: assert dominance.
    ctx.broadcast({ type: "coordinator", leader: ctx.id });
    return { leader: ctx.id };
  }
}

const sim = new Simulation({ seed: 1 });
for (const id of ["n1", "n2", "n3", "n4", "n5"]) sim.addNode(id, new Bully());
sim.run({ until: 2000 });
console.log(sim.stateOf<BullyState>("n1")); // → { leader: "n5" }
```

That is the entire integration: implement the interface, `addNode`, `run`. No engine edits, no
registration step.

## Making it a lab scenario

To drive your protocol from the UI, add an entry to `web/scenarios.ts` whose `populate` adds the
nodes (and any client traffic). It will appear in the scenario dropdown with the full inspector,
telemetry, chaos controls, and timeline applied automatically.

## What you get for free

Once your protocol runs in the engine, every Constellation capability applies without extra work:

- **Internal state** — surfaced live in the inspector (`sim.stateOf`).
- **Event timeline & history** — every send, delivery, timer, and log is recorded.
- **Metrics & traces** — derived from the event stream.
- **Deterministic replay & time travel** — re-run or scrub to any past instant.
- **Fault injection** — partitions, loss, latency, crashes via the chaos framework.
- **Reproducibility** — the whole run is a pure function of the seed.

```

```
