/**
 * The engine's observable event stream.
 *
 * Every meaningful thing the engine does is published as a typed {@link SimEvent}
 * with a virtual timestamp and a globally monotonic sequence number. This stream
 * is the single source of truth that later milestones turn into metrics, logs,
 * traces, a scrubable timeline, and deterministic replay.
 *
 * Events are append-only and ordered by `seq`; replaying them reconstructs the
 * exact history of a run.
 */
import type { Envelope, LogLevel, NodeId, SimTime } from "./types.js";

interface Base {
  /** Globally monotonic sequence number, unique and ordered within a run. */
  readonly seq: number;
  /** Virtual time at which the event occurred. */
  readonly time: SimTime;
}

export type SimEvent =
  | (Base & { readonly kind: "node:added"; readonly nodeId: NodeId; readonly protocol: string })
  | (Base & { readonly kind: "node:init"; readonly nodeId: NodeId })
  | (Base & { readonly kind: "node:crashed"; readonly nodeId: NodeId })
  | (Base & { readonly kind: "node:restarted"; readonly nodeId: NodeId })
  | (Base & { readonly kind: "message:sent"; readonly envelope: Envelope })
  | (Base & { readonly kind: "message:delivered"; readonly envelope: Envelope })
  | (Base & {
      readonly kind: "message:dropped";
      readonly envelope: Envelope;
      readonly reason: string;
    })
  | (Base & {
      readonly kind: "timer:set";
      readonly nodeId: NodeId;
      readonly timerId: number;
      readonly token: string;
      readonly fireAt: SimTime;
    })
  | (Base & {
      readonly kind: "timer:fired";
      readonly nodeId: NodeId;
      readonly timerId: number;
      readonly token: string;
    })
  | (Base & {
      readonly kind: "timer:cleared";
      readonly nodeId: NodeId;
      readonly timerId: number;
    })
  | (Base & {
      readonly kind: "log";
      readonly nodeId: NodeId;
      readonly level: LogLevel;
      readonly message: string;
      readonly fields: Record<string, unknown>;
    })
  | (Base & { readonly kind: "action"; readonly label: string });

/** The discriminant values of {@link SimEvent}, useful for filtering. */
export type SimEventKind = SimEvent["kind"];

/** A subscriber to the engine's event stream. Must not throw. */
export type Observer = (event: SimEvent) => void;
