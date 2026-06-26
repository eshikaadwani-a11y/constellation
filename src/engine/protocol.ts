/**
 * The protocol plugin contract — the seam that makes Constellation a framework
 * rather than a demo.
 *
 * A {@link Protocol} is a pure reducer: it reacts to messages and timers and
 * expresses every side effect through the {@link NodeContext} the engine hands
 * it. It never touches the scheduler, the clock, or other nodes directly. That
 * discipline is exactly what lets the engine record, replay, and visualize a
 * run without the protocol being aware any of it is happening.
 *
 * Implementing a new distributed algorithm (Raft, gossip, a CRDT, …) means
 * writing one of these. The engine requires no changes.
 */
import type { LogLevel, Message, NodeId, SimTime, TimerId } from "./types.js";

/**
 * The capabilities a node has during a callback. All randomness is drawn from
 * the node's own deterministic stream, so protocols can make randomized
 * decisions (e.g. Raft's election timeout) without breaking reproducibility.
 */
export interface NodeContext<M extends Message = Message> {
  /** This node's identity. */
  readonly id: NodeId;
  /** Current virtual time. */
  readonly now: SimTime;
  /** All other nodes currently in the cluster. */
  readonly peers: readonly NodeId[];

  /** Hands a message to the network for delivery to `to`. */
  send(to: NodeId, message: M): void;
  /** Sends a message to every peer (everyone except this node). */
  broadcast(message: M): void;

  /** Schedules a wake-up after `delay` virtual ms. Returns a cancellable handle. */
  setTimer(delay: SimTime, token: string): TimerId;
  /** Cancels a previously scheduled timer. No-op if it already fired. */
  clearTimer(id: TimerId): void;

  /** A deterministic float in [0, 1) from this node's stream. */
  random(): number;
  /** A deterministic integer in [min, max] from this node's stream. */
  randomInt(min: number, max: number): number;

  /** Emits a structured log line tied to the current virtual time. */
  log(level: LogLevel, message: string, fields?: Record<string, unknown>): void;
}

/**
 * A distributed algorithm, expressed as a state reducer over inputs.
 *
 * @typeParam S - The node's private state type.
 * @typeParam M - The message union this protocol exchanges.
 */
export interface Protocol<S, M extends Message = Message> {
  /** A human-readable name, shown in the UI and logs. */
  readonly name: string;

  /** Produces the node's initial state. May send messages and arm timers. */
  init(ctx: NodeContext<M>): S;

  /** Handles an incoming message, returning the next state. */
  onMessage(ctx: NodeContext<M>, state: S, from: NodeId, message: M): S;

  /** Handles a fired timer, returning the next state. */
  onTimer(ctx: NodeContext<M>, state: S, token: string): S;
}
