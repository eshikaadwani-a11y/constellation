/**
 * Per-node runtime state held by the engine.
 *
 * This is the engine's private bookkeeping for a node: the protocol driving it,
 * its current (opaque) state, its deterministic RNG stream, and whether it is
 * currently crashed. Protocols never see this object — they only ever interact
 * through {@link NodeContext}.
 */
import type { Random } from "../core/prng.js";
import type { Protocol } from "./protocol.js";
import type { Message, NodeId } from "./types.js";

export class NodeRuntime {
  /** The protocol's current private state. Opaque to the engine. */
  state: unknown;
  /** A crashed node ignores all deliveries and timers until restarted. */
  crashed = false;

  constructor(
    readonly id: NodeId,
    readonly protocol: Protocol<unknown, Message>,
    /** This node's independent, deterministic random stream. */
    readonly rng: Random,
  ) {}
}
