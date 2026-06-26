/**
 * Demonstration scenarios for the topology canvas.
 *
 * These are small, genuine protocols — a token ring, epidemic gossip, and an
 * all-to-all heartbeat — chosen because each produces a visually distinct
 * traffic pattern. The marquee algorithms (Raft and friends) arrive in their
 * own milestones; these exist to exercise the visualization with real,
 * deterministic message flow.
 */
import { Simulation, raft, type Message, type NodeId, type Protocol } from "@constellation/engine";

export interface Scenario {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly defaultNodes: number;
  readonly minNodes: number;
  readonly maxNodes: number;
  /** Adds nodes and initial traffic to an already-created simulation. */
  populate(sim: Simulation, nodeCount: number): void;
}

const ids = (count: number): NodeId[] => Array.from({ length: count }, (_, i) => `n${i + 1}`);

// --- Token ring ------------------------------------------------------------

interface Token extends Message {
  type: "token";
  hops: number;
}

function ringNode(next: NodeId): Protocol<{ hops: number }, Token> {
  return {
    name: "token-ring",
    init: () => ({ hops: 0 }),
    onMessage(ctx, _state, _from, message) {
      ctx.log("info", "holds the token", { hops: message.hops });
      ctx.setTimer(ctx.randomInt(180, 360), "forward");
      return { hops: message.hops };
    },
    onTimer(ctx, state) {
      ctx.send(next, { type: "token", hops: state.hops + 1 });
      return state;
    },
  };
}

// --- Epidemic gossip -------------------------------------------------------

interface Rumor extends Message {
  type: "rumor";
}

function gossipNode(seeded: boolean): Protocol<{ knows: boolean; pushes: number }, Rumor> {
  return {
    name: "gossip",
    init(ctx) {
      ctx.setTimer(ctx.randomInt(250, 500), "gossip");
      return { knows: seeded, pushes: 0 };
    },
    onMessage(ctx, state) {
      if (!state.knows) ctx.log("info", "learned the rumor");
      return { ...state, knows: true };
    },
    onTimer(ctx, state) {
      ctx.setTimer(ctx.randomInt(250, 500), "gossip");
      if (state.knows && ctx.peers.length > 0) {
        const peer = ctx.peers[ctx.randomInt(0, ctx.peers.length - 1)] as NodeId;
        ctx.send(peer, { type: "rumor" });
        return { ...state, pushes: state.pushes + 1 };
      }
      return state;
    },
  };
}

// --- All-to-all heartbeat --------------------------------------------------

function heartbeatNode(): Protocol<{ beats: number }, Message> {
  return {
    name: "heartbeat",
    init(ctx) {
      ctx.setTimer(ctx.randomInt(400, 800), "beat");
      return { beats: 0 };
    },
    onMessage: (_ctx, state) => state,
    onTimer(ctx, state) {
      ctx.broadcast({ type: "heartbeat" });
      ctx.setTimer(ctx.randomInt(400, 800), "beat");
      return { beats: state.beats + 1 };
    },
  };
}

export const SCENARIOS: Scenario[] = [
  {
    id: "raft",
    name: "Raft consensus",
    description: "Leader election and log replication. Crash the leader and watch a new one rise.",
    defaultNodes: 5,
    minNodes: 3,
    maxNodes: 9,
    populate(sim, nodeCount) {
      // Election timeouts are tuned well above the network round-trip so
      // elections are stable under the lab's 40–140ms link latency.
      const opts = { electionTimeoutMin: 800, electionTimeoutMax: 1500, heartbeatInterval: 250 };
      ids(nodeCount).forEach((id) => sim.addNode(id, raft(opts)));
      // A trickle of client commands so the replicated log grows on screen.
      let k = 0;
      const propose = (): void => {
        sim.inject("n1", { type: "propose", command: `set x=${k}` }, "client");
        k += 1;
        sim.schedule(2200, propose);
      };
      sim.schedule(2500, propose);
    },
  },
  {
    id: "ring",
    name: "Token ring",
    description: "A single token circulates a ring of nodes, one hop at a time.",
    defaultNodes: 6,
    minNodes: 3,
    maxNodes: 16,
    populate(sim, nodeCount) {
      const ring = ids(nodeCount);
      ring.forEach((id, i) => sim.addNode(id, ringNode(ring[(i + 1) % ring.length] as NodeId)));
      // Hand the token to the first node from the last (a real edge, so it shows).
      sim.schedule(0, () =>
        sim.inject(ring[0] as NodeId, { type: "token", hops: 0 }, ring[ring.length - 1] as NodeId),
      );
    },
  },
  {
    id: "gossip",
    name: "Epidemic gossip",
    description: "One node starts with a rumor; watch it spread across the cluster.",
    defaultNodes: 10,
    minNodes: 4,
    maxNodes: 30,
    populate(sim, nodeCount) {
      ids(nodeCount).forEach((id, i) => sim.addNode(id, gossipNode(i === 0)));
    },
  },
  {
    id: "heartbeat",
    name: "All-to-all heartbeat",
    description: "Every node periodically broadcasts a heartbeat to all peers.",
    defaultNodes: 7,
    minNodes: 3,
    maxNodes: 14,
    populate(sim, nodeCount) {
      ids(nodeCount).forEach((id) => sim.addNode(id, heartbeatNode()));
    },
  },
];

export function scenarioById(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? (SCENARIOS[0] as Scenario);
}
