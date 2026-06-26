/**
 * Demonstration scenarios for the topology canvas.
 *
 * These are small, genuine protocols — a token ring, epidemic gossip, and an
 * all-to-all heartbeat — chosen because each produces a visually distinct
 * traffic pattern. The marquee algorithms (Raft and friends) arrive in their
 * own milestones; these exist to exercise the visualization with real,
 * deterministic message flow.
 */
import {
  Simulation,
  controlPlane,
  gossip,
  gossipSet,
  kubelet,
  raft,
  twoPhaseCommitCoordinator,
  twoPhaseCommitParticipant,
  type Message,
  type NodeId,
  type Protocol,
} from "@constellation/engine";

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
    description: "Anti-entropy dissemination: a value injected at one node spreads to all.",
    defaultNodes: 12,
    minNodes: 4,
    maxNodes: 80,
    populate(sim, nodeCount) {
      ids(nodeCount).forEach((id) => sim.addNode(id, gossip({ interval: 280 })));
      // Seed a value at n1, then keep updating it so dissemination is ongoing.
      let v = 1;
      const update = (): void => {
        sim.inject("n1", gossipSet("leader", `epoch-${v}`, v), "client");
        v += 1;
        sim.schedule(4000, update);
      };
      sim.schedule(400, update);
    },
  },
  {
    id: "2pc",
    name: "Two-phase commit",
    description: "Atomic distributed transactions — crash the coordinator to see 2PC block.",
    defaultNodes: 5,
    minNodes: 3,
    maxNodes: 9,
    populate(sim, nodeCount) {
      const all = ids(nodeCount);
      sim.addNode(all[0] as NodeId, twoPhaseCommitCoordinator({ timeout: 3000 }));
      // Most participants vote yes; the last one occasionally refuses.
      all.slice(1).forEach((id, i) => {
        const refuses = i === all.length - 2;
        sim.addNode(
          id,
          twoPhaseCommitParticipant((txId) => !(refuses && txId % 4 === 0)),
        );
      });
      let txId = 1;
      const begin = (): void => {
        sim.inject(all[0] as NodeId, { type: "2pc-begin", txId }, "client");
        txId += 1;
        sim.schedule(3500, begin);
      };
      sim.schedule(800, begin);
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
  {
    id: "cloud",
    name: "Cloud orchestration",
    description:
      "A Kubernetes-style control plane bin-packs pods onto machines. Crash one to watch rescheduling.",
    defaultNodes: 6,
    minNodes: 4,
    maxNodes: 12,
    populate(sim, nodeCount) {
      const machines = nodeCount - 1; // one node is the control plane
      sim.addNode(
        "control",
        controlPlane({
          reconcileInterval: 500,
          heartbeatTimeout: 1500,
          deployments: [
            {
              type: "kube-deploy",
              name: "web",
              replicas: machines * 2,
              request: { cpu: 2, memory: 4 },
              hpa: { min: 2, max: machines * 3, target: 60 },
            },
          ],
        }),
      );
      for (let i = 0; i < machines; i++) {
        sim.addNode(`m${i + 1}`, kubelet("control", { cpu: 8, memory: 16 }));
      }
      // Oscillating load drives the horizontal autoscaler.
      let t = 0;
      const load = (): void => {
        const utilization = 45 + 45 * Math.abs(Math.sin(t));
        sim.inject("control", { type: "kube-load", name: "web", utilization }, "client");
        t += 0.6;
        sim.schedule(3000, load);
      };
      sim.schedule(2000, load);
    },
  },
];

export function scenarioById(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? (SCENARIOS[0] as Scenario);
}
