/**
 * Foundational types shared across the simulation engine.
 *
 * These are deliberately small and protocol-agnostic. The engine moves opaque
 * {@link Message} envelopes between nodes and never inspects their contents — a
 * protocol gives them meaning.
 */

/** A node's stable identity within a cluster. */
export type NodeId = string;

/** Virtual time, measured in integer milliseconds. There is no wall clock. */
export type SimTime = number;

/** Handle for a scheduled timer, unique within a run. */
export type TimerId = number;

/** Severity for structured log lines emitted by protocols. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * The base shape every protocol message must have. Protocols define their own
 * discriminated unions on top of the `type` tag.
 */
export interface Message {
  readonly type: string;
}

/** A message in flight, with the metadata the engine and UI need to track it. */
export interface Envelope<M extends Message = Message> {
  /** Monotonic id assigned at send time; unique within a run. */
  readonly id: number;
  readonly from: NodeId;
  readonly to: NodeId;
  readonly message: M;
  /** Virtual time the message was handed to the network. */
  readonly sentAt: SimTime;
}
