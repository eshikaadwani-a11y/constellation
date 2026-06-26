/**
 * Distributed tracing.
 *
 * Each message carries the id of the message whose delivery caused it (see
 * `Envelope.causedBy`). Following that lineage turns a flat event stream into a
 * forest of causal traces: a client request becomes a root span, and every RPC
 * it triggers becomes a nested child — the distributed-systems analogue of a
 * flame graph.
 */
import type { SimEvent } from "../engine/events.js";
import type { NodeId, SimTime } from "../engine/types.js";

export interface TraceSpan {
  readonly id: number;
  readonly from: NodeId;
  readonly to: NodeId;
  readonly type: string;
  readonly sentAt: SimTime;
  /** Delivery time, or undefined if dropped or still in flight. */
  deliveredAt?: SimTime;
  dropped: boolean;
  readonly children: TraceSpan[];
}

export interface TraceForest {
  readonly roots: TraceSpan[];
  /** Total number of spans (messages) across all traces. */
  readonly size: number;
  /** Depth of the deepest causal chain. */
  readonly maxDepth: number;
}

/** Reconstructs the causal forest from a recorded event stream. */
export function buildTraces(events: readonly SimEvent[]): TraceForest {
  const spans = new Map<number, TraceSpan>();
  const parentOf = new Map<number, number | undefined>();

  for (const e of events) {
    if (e.kind === "message:sent") {
      const { id, from, to, message, sentAt, causedBy } = e.envelope;
      spans.set(id, { id, from, to, type: message.type, sentAt, dropped: false, children: [] });
      parentOf.set(id, causedBy);
    } else if (e.kind === "message:delivered") {
      const span = spans.get(e.envelope.id);
      if (span) span.deliveredAt = e.time;
    } else if (e.kind === "message:dropped") {
      const span = spans.get(e.envelope.id);
      if (span) span.dropped = true;
    }
  }

  const roots: TraceSpan[] = [];
  for (const [id, span] of spans) {
    const parentId = parentOf.get(id);
    const parent = parentId !== undefined ? spans.get(parentId) : undefined;
    if (parent) parent.children.push(span);
    else roots.push(span);
  }

  // Stable ordering by send time for deterministic rendering.
  const sortChildren = (span: TraceSpan): void => {
    span.children.sort((a, b) => a.sentAt - b.sentAt || a.id - b.id);
    span.children.forEach(sortChildren);
  };
  roots.sort((a, b) => a.sentAt - b.sentAt || a.id - b.id);
  roots.forEach(sortChildren);

  let maxDepth = 0;
  const depth = (span: TraceSpan, d: number): void => {
    maxDepth = Math.max(maxDepth, d);
    for (const child of span.children) depth(child, d + 1);
  };
  for (const root of roots) depth(root, 1);

  return { roots, size: spans.size, maxDepth };
}
