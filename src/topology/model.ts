/**
 * The topology model.
 *
 * A {@link TopologyModel} subscribes to a simulation's event stream and folds it
 * into a live, renderable picture of the cluster: which nodes exist and whether
 * they are up, which links carry traffic, and which messages are currently in
 * flight (with the timing needed to animate them). It is pure, isomorphic logic
 * — no DOM — so the visualization's brain can be unit-tested without a browser.
 *
 * The React layer simply renders {@link TopologyModel.snapshot}; it owns no
 * topology logic of its own.
 */
import type { SimEvent } from "../engine/events.js";
import type { Simulation } from "../engine/simulation.js";
import type { NodeId, SimTime } from "../engine/types.js";

export interface TopoNode {
  readonly id: NodeId;
  readonly protocol: string;
  status: "up" | "down";
  /** Messages this node has sent / received — drives the activity heatmap. */
  sent: number;
  received: number;
  /** Virtual time of this node's most recent activity. */
  lastActiveAt: SimTime;
}

export interface TopoLink {
  /** Stable directed id, `${source}->${target}`. */
  readonly id: string;
  readonly source: NodeId;
  readonly target: NodeId;
  /** Total messages observed travelling this direction. */
  messages: number;
}

export interface InFlightMessage {
  /** Envelope id. */
  readonly id: number;
  readonly from: NodeId;
  readonly to: NodeId;
  readonly type: string;
  readonly sentAt: SimTime;
  readonly deliverAt: SimTime;
}

export interface TopologySnapshot {
  /** Virtual time of the most recent event folded in. */
  readonly time: SimTime;
  readonly nodes: TopoNode[];
  readonly links: TopoLink[];
  readonly inFlight: InFlightMessage[];
  readonly delivered: number;
  readonly dropped: number;
}

export class TopologyModel {
  private readonly nodes = new Map<NodeId, TopoNode>();
  private readonly links = new Map<string, TopoLink>();
  private readonly inFlight = new Map<number, InFlightMessage>();
  private time: SimTime = 0;
  private delivered = 0;
  private dropped = 0;

  /** Folds a single event into the model. */
  apply(event: SimEvent): void {
    this.time = event.time;
    switch (event.kind) {
      case "node:added":
        this.nodes.set(event.nodeId, {
          id: event.nodeId,
          protocol: event.protocol,
          status: "up",
          sent: 0,
          received: 0,
          lastActiveAt: event.time,
        });
        return;
      case "node:crashed":
        this.setStatus(event.nodeId, "down");
        return;
      case "node:restarted":
        this.setStatus(event.nodeId, "up");
        return;
      case "message:sent": {
        const { from, to, id, message, sentAt } = event.envelope;
        this.touch(from, "sent", event.time);
        if (this.nodes.has(from) && this.nodes.has(to)) {
          this.bumpLink(from, to);
          if (event.deliverAt !== undefined) {
            this.inFlight.set(id, {
              id,
              from,
              to,
              type: message.type,
              sentAt,
              deliverAt: event.deliverAt,
            });
          }
        }
        return;
      }
      case "message:delivered":
        this.inFlight.delete(event.envelope.id);
        this.delivered++;
        this.touch(event.envelope.to, "received", event.time);
        return;
      case "message:dropped":
        this.inFlight.delete(event.envelope.id);
        this.dropped++;
        return;
      default:
        // timer:* and log events do not change the topology shape.
        return;
    }
  }

  /** Subscribes the model to a simulation. Returns an unsubscribe function. */
  attach(sim: Simulation): () => void {
    return sim.subscribe((event) => this.apply(event));
  }

  private setStatus(id: NodeId, status: "up" | "down"): void {
    const node = this.nodes.get(id);
    if (node) {
      node.status = status;
      node.lastActiveAt = this.time;
    }
  }

  private touch(id: NodeId, kind: "sent" | "received", time: SimTime): void {
    const node = this.nodes.get(id);
    if (!node) return;
    if (kind === "sent") node.sent++;
    else node.received++;
    node.lastActiveAt = time;
  }

  private bumpLink(source: NodeId, target: NodeId): void {
    const id = `${source}->${target}`;
    const existing = this.links.get(id);
    if (existing) existing.messages++;
    else this.links.set(id, { id, source, target, messages: 1 });
  }

  /** Returns an immutable view of the current topology. */
  snapshot(): TopologySnapshot {
    return {
      time: this.time,
      nodes: [...this.nodes.values()].map((n) => ({ ...n })),
      links: [...this.links.values()].map((l) => ({ ...l })),
      inFlight: [...this.inFlight.values()],
      delivered: this.delivered,
      dropped: this.dropped,
    };
  }

  /** Number of messages currently in flight. */
  get inFlightCount(): number {
    return this.inFlight.size;
  }

  /**
   * Rebuilds a model from a snapshot, so folding can resume from a checkpoint
   * rather than from the beginning of history — the basis for fast replay.
   */
  static fromSnapshot(snap: TopologySnapshot): TopologyModel {
    const model = new TopologyModel();
    model.time = snap.time;
    model.delivered = snap.delivered;
    model.dropped = snap.dropped;
    for (const n of snap.nodes) model.nodes.set(n.id, { ...n });
    for (const l of snap.links) model.links.set(l.id, { ...l });
    for (const f of snap.inFlight) model.inFlight.set(f.id, { ...f });
    return model;
  }
}
