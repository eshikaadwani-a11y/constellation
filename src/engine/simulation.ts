/**
 * The simulation kernel.
 *
 * A `Simulation` is a deterministic discrete-event scheduler. It owns a virtual
 * clock and a priority queue of pending tasks ordered by `(time, sequence)`,
 * and it advances by repeatedly popping the earliest task and dispatching it —
 * which may schedule further tasks in the future.
 *
 * Every source of nondeterminism is removed:
 *   - there is no wall clock; time is an integer that only moves forward,
 *   - ties at equal timestamps break by insertion order via a sequence number,
 *   - all randomness derives from a single seed, with each node and the network
 *     drawing from independent, deterministically-forked streams.
 *
 * The result: a run is a pure function of `(seed, scenario)`. The same inputs
 * always produce the same event stream — the property that makes replay and
 * time-travel debugging possible.
 */
import { MinHeap } from "../core/heap.js";
import { Random } from "../core/prng.js";
import type { Observer, SimEvent } from "./events.js";
import { NodeRuntime } from "./node.js";
import type { NodeContext, Protocol } from "./protocol.js";
import { FixedLatencyTransport, type Transport } from "./transport.js";
import type { Envelope, Message, NodeId, SimTime, TimerId } from "./types.js";

/** Internal unit of scheduled work. Not exposed; the public surface is events. */
type Task =
  | { readonly kind: "deliver"; time: SimTime; seq: number; readonly envelope: Envelope }
  | {
      readonly kind: "timer";
      time: SimTime;
      seq: number;
      readonly nodeId: NodeId;
      readonly timerId: TimerId;
      readonly token: string;
    }
  | {
      readonly kind: "action";
      time: SimTime;
      seq: number;
      readonly label: string;
      readonly run: () => void;
    };

export interface SimulationOptions {
  /** The seed that makes the entire run reproducible. */
  readonly seed: number;
  /** The network model. Defaults to a lossless 1ms link. */
  readonly transport?: Transport;
}

export interface RunOptions {
  /** Stop once the virtual clock would pass this time. Advances time to it. */
  readonly until?: SimTime;
  /** Safety valve: stop after processing this many tasks. */
  readonly maxSteps?: number;
}

export interface RunResult {
  /** Number of tasks dispatched in this call. */
  readonly steps: number;
  /** Virtual time when the call returned. */
  readonly now: SimTime;
  /** True if the queue drained (rather than hitting a limit). */
  readonly idle: boolean;
}

export class Simulation {
  private clock: SimTime = 0;
  private taskSeq = 0;
  private eventSeq = 0;
  private nextMessageId = 1;
  private nextTimerId = 1;

  private readonly queue = new MinHeap<Task>((a, b) => a.time - b.time || a.seq - b.seq);
  private readonly nodes = new Map<NodeId, NodeRuntime>();
  private readonly order: NodeId[] = [];
  private readonly timers = new Map<TimerId, { readonly nodeId: NodeId; active: boolean }>();
  private readonly observers = new Set<Observer>();

  private readonly master: Random;
  private readonly transportRng: Random;
  private readonly transport: Transport;

  constructor(options: SimulationOptions) {
    this.master = new Random(options.seed);
    // The network's stream is forked first so it is stable regardless of how
    // many nodes are later added.
    this.transportRng = this.master.fork();
    this.transport = options.transport ?? new FixedLatencyTransport();
  }

  // ---- Introspection --------------------------------------------------------

  /** Current virtual time. */
  get now(): SimTime {
    return this.clock;
  }

  /** Number of events emitted so far (also the next event's sequence number). */
  get eventCount(): number {
    return this.eventSeq;
  }

  /** Number of tasks still pending in the queue. */
  get pending(): number {
    return this.queue.size;
  }

  /** Node ids in insertion order. */
  nodeIds(): NodeId[] {
    return [...this.order];
  }

  /** The protocol state of a node, typed by the caller. */
  stateOf<S>(id: NodeId): S | undefined {
    return this.nodes.get(id)?.state as S | undefined;
  }

  /** Whether a node is currently crashed. */
  isCrashed(id: NodeId): boolean {
    return this.nodes.get(id)?.crashed ?? false;
  }

  // ---- Observability --------------------------------------------------------

  /** Subscribes to the event stream. Returns an unsubscribe function. */
  subscribe(observer: Observer): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  private emit(event: SimEvent): void {
    for (const observer of this.observers) observer(event);
  }

  // ---- Topology -------------------------------------------------------------

  /**
   * Adds a node running `protocol` and initializes it immediately. Initialization
   * runs at the current virtual time and may send messages and arm timers.
   */
  addNode<S, M extends Message>(id: NodeId, protocol: Protocol<S, M>): void {
    if (this.nodes.has(id)) throw new Error(`duplicate node id: ${id}`);
    const erased = protocol as unknown as Protocol<unknown, Message>;
    const node = new NodeRuntime(id, erased, this.master.fork());
    this.nodes.set(id, node);
    this.order.push(id);
    this.emit({
      kind: "node:added",
      seq: this.eventSeq++,
      time: this.clock,
      nodeId: id,
      protocol: protocol.name,
    });

    node.state = erased.init(this.contextFor(node));
    this.emit({ kind: "node:init", seq: this.eventSeq++, time: this.clock, nodeId: id });
  }

  /** Crashes a node: it ignores all deliveries and timers until restarted. */
  crash(id: NodeId): void {
    const node = this.nodes.get(id);
    if (!node || node.crashed) return;
    node.crashed = true;
    this.emit({ kind: "node:crashed", seq: this.eventSeq++, time: this.clock, nodeId: id });
  }

  /** Restarts a crashed node. Its protocol state is retained across the crash. */
  restart(id: NodeId): void {
    const node = this.nodes.get(id);
    if (!node || !node.crashed) return;
    node.crashed = false;
    this.emit({ kind: "node:restarted", seq: this.eventSeq++, time: this.clock, nodeId: id });
  }

  // ---- External drivers (clients, chaos) ------------------------------------

  /** Injects a message into the cluster from outside (e.g. a client request). */
  inject<M extends Message>(to: NodeId, message: M, from: NodeId = "client"): void {
    this.dispatchSend(from, to, message);
  }

  /** Runs `action` after `delay` virtual ms. */
  schedule(delay: SimTime, action: () => void, label = "action"): void {
    this.scheduleAt(this.clock + delay, action, label);
  }

  /** Runs `action` at absolute virtual time `time` (which must not be in the past). */
  scheduleAt(time: SimTime, action: () => void, label = "action"): void {
    if (time < this.clock)
      throw new RangeError(`cannot schedule into the past (${time} < ${this.clock})`);
    this.queue.push({ kind: "action", time, seq: this.taskSeq++, label, run: action });
  }

  // ---- Run loop -------------------------------------------------------------

  /** Processes a single task. Returns false if the queue was empty. */
  step(): boolean {
    const task = this.queue.pop();
    if (!task) return false;
    this.clock = task.time;
    this.dispatch(task);
    return true;
  }

  /**
   * Runs the simulation until the queue drains, the horizon is reached, or the
   * step budget is exhausted — whichever comes first.
   */
  run(options: RunOptions = {}): RunResult {
    const { until, maxSteps } = options;
    let steps = 0;
    for (;;) {
      if (maxSteps !== undefined && steps >= maxSteps) {
        return { steps, now: this.clock, idle: false };
      }
      const next = this.queue.peek();
      if (!next) break;
      if (until !== undefined && next.time > until) break;
      this.queue.pop();
      this.clock = next.time;
      this.dispatch(next);
      steps++;
    }
    if (until !== undefined && this.clock < until) this.clock = until;
    return { steps, now: this.clock, idle: this.queue.isEmpty() };
  }

  private dispatch(task: Task): void {
    switch (task.kind) {
      case "deliver":
        this.deliver(task.envelope);
        return;
      case "timer":
        this.fireTimer(task.nodeId, task.timerId, task.token);
        return;
      case "action":
        this.emit({ kind: "action", seq: this.eventSeq++, time: this.clock, label: task.label });
        task.run();
        return;
    }
  }

  private deliver(envelope: Envelope): void {
    const node = this.nodes.get(envelope.to);
    if (!node) {
      this.emitDrop(envelope, "no-such-node");
      return;
    }
    if (node.crashed) {
      this.emitDrop(envelope, "node-crashed");
      return;
    }
    this.emit({ kind: "message:delivered", seq: this.eventSeq++, time: this.clock, envelope });
    node.state = node.protocol.onMessage(
      this.contextFor(node),
      node.state,
      envelope.from,
      envelope.message,
    );
  }

  private fireTimer(nodeId: NodeId, timerId: TimerId, token: string): void {
    const entry = this.timers.get(timerId);
    if (!entry || !entry.active) return; // cleared before firing
    const node = this.nodes.get(nodeId);
    this.timers.delete(timerId);
    if (!node || node.crashed) return;
    this.emit({
      kind: "timer:fired",
      seq: this.eventSeq++,
      time: this.clock,
      nodeId,
      timerId,
      token,
    });
    node.state = node.protocol.onTimer(this.contextFor(node), node.state, token);
  }

  // ---- Effects from protocol callbacks --------------------------------------

  private dispatchSend(from: NodeId, to: NodeId, message: Message): void {
    const envelope: Envelope = {
      id: this.nextMessageId++,
      from,
      to,
      message,
      sentAt: this.clock,
    };

    const decision = this.transport.route(envelope, this.transportRng, this.clock);
    if (!decision.deliver) {
      this.emit({ kind: "message:sent", seq: this.eventSeq++, time: this.clock, envelope });
      this.emitDrop(envelope, decision.reason ?? "dropped");
      return;
    }
    const deliverAt = this.clock + Math.max(0, Math.round(decision.latency));
    this.emit({
      kind: "message:sent",
      seq: this.eventSeq++,
      time: this.clock,
      envelope,
      deliverAt,
    });
    this.queue.push({ kind: "deliver", time: deliverAt, seq: this.taskSeq++, envelope });
  }

  private emitDrop(envelope: Envelope, reason: string): void {
    this.emit({
      kind: "message:dropped",
      seq: this.eventSeq++,
      time: this.clock,
      envelope,
      reason,
    });
  }

  /** Builds the capability object handed to a protocol for one callback. */
  private contextFor(node: NodeRuntime): NodeContext {
    const sim = this;
    return {
      id: node.id,
      get now() {
        return sim.clock;
      },
      get peers() {
        return sim.order.filter((other) => other !== node.id);
      },
      send: (to, message) => sim.dispatchSend(node.id, to, message),
      broadcast: (message) => {
        for (const peer of sim.order) {
          if (peer !== node.id) sim.dispatchSend(node.id, peer, message);
        }
      },
      setTimer: (delay, token) => {
        const timerId = sim.nextTimerId++;
        sim.timers.set(timerId, { nodeId: node.id, active: true });
        const fireAt = sim.clock + Math.max(0, Math.round(delay));
        sim.queue.push({
          kind: "timer",
          time: fireAt,
          seq: sim.taskSeq++,
          nodeId: node.id,
          timerId,
          token,
        });
        sim.emit({
          kind: "timer:set",
          seq: sim.eventSeq++,
          time: sim.clock,
          nodeId: node.id,
          timerId,
          token,
          fireAt,
        });
        return timerId;
      },
      clearTimer: (id) => {
        const entry = sim.timers.get(id);
        if (!entry || !entry.active) return;
        entry.active = false;
        sim.emit({
          kind: "timer:cleared",
          seq: sim.eventSeq++,
          time: sim.clock,
          nodeId: node.id,
          timerId: id,
        });
      },
      random: () => node.rng.next(),
      randomInt: (min, max) => node.rng.int(min, max),
      log: (level, message, fields) => {
        sim.emit({
          kind: "log",
          seq: sim.eventSeq++,
          time: sim.clock,
          nodeId: node.id,
          level,
          message,
          fields: fields ?? {},
        });
      },
    };
  }
}
