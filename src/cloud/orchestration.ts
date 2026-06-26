/**
 * Cloud orchestration as engine protocols.
 *
 * A tiny but faithful control plane, modelled after Kubernetes:
 *
 *   - **Kubelets** are machine nodes. They advertise capacity via periodic
 *     heartbeats and run whatever pods the control plane assigns.
 *   - The **control plane** is a node that tracks machines, reconciles desired
 *     vs. actual state, bin-packs pending pods with the scheduler, and detects
 *     dead machines by missed heartbeats — rescheduling their pods elsewhere.
 *   - A **horizontal autoscaler** adjusts replica counts from a load signal.
 *
 * Because it is built from ordinary protocols, the orchestrator inherits the
 * whole platform: crash a kubelet with the chaos tools and watch the control
 * plane notice the missed heartbeats and reschedule; scrub the timeline to see
 * exactly when each pod moved.
 */
import type { Protocol } from "../engine/protocol.js";
import type { Message, NodeId } from "../engine/types.js";
import {
  desiredReplicas,
  placePods,
  type MachineCapacity,
  type Pod,
  type Resources,
  ZERO,
  addRes,
} from "./scheduler.js";

// --- Messages --------------------------------------------------------------

interface Heartbeat extends Message {
  type: "kube-heartbeat";
  capacity: Resources;
}
interface Assign extends Message {
  type: "kube-assign";
  pod: Pod;
}
interface Evict extends Message {
  type: "kube-evict";
  podId: string;
}
interface Deploy extends Message {
  type: "kube-deploy";
  name: string;
  replicas: number;
  request: Resources;
  hpa?: { min: number; max: number; target: number };
}
interface Load extends Message {
  type: "kube-load";
  name: string;
  utilization: number;
}

export type KubeMessage = Heartbeat | Assign | Evict | Deploy | Load;

// --- Kubelet (machine) -----------------------------------------------------

export interface KubeletState {
  capacity: Resources;
  used: Resources;
  pods: Record<string, Resources>;
}

export interface KubeletOptions {
  readonly heartbeatInterval?: number;
}

/** A machine node: heartbeats its capacity and runs assigned pods. */
export function kubelet(
  controlPlane: NodeId,
  capacity: Resources,
  options: KubeletOptions = {},
): Protocol<KubeletState, KubeMessage> {
  const interval = options.heartbeatInterval ?? 400;
  return {
    name: "kubelet",
    init(ctx) {
      ctx.send(controlPlane, { type: "kube-heartbeat", capacity });
      ctx.setTimer(ctx.randomInt(Math.floor(interval / 2), interval), "heartbeat");
      return { capacity, used: ZERO, pods: {} };
    },
    onMessage(ctx, state, _from, message) {
      if (message.type === "kube-assign") {
        if (!state.pods[message.pod.id]) {
          state.pods[message.pod.id] = message.pod.request;
          state.used = addRes(state.used, message.pod.request);
          ctx.log("info", "pod scheduled", { pod: message.pod.id });
        }
      } else if (message.type === "kube-evict") {
        const req = state.pods[message.podId];
        if (req) {
          delete state.pods[message.podId];
          state.used = { cpu: state.used.cpu - req.cpu, memory: state.used.memory - req.memory };
        }
      }
      return state;
    },
    onTimer(ctx, state) {
      ctx.send(controlPlane, { type: "kube-heartbeat", capacity });
      ctx.setTimer(interval, "heartbeat");
      return state;
    },
  };
}

// --- Control plane ---------------------------------------------------------

interface DeploymentSpec {
  replicas: number;
  request: Resources;
  hpa?: { min: number; max: number; target: number };
}

interface PodRecord {
  deployment: string;
  request: Resources;
  machineId: string | null;
}

export interface ControlPlaneState {
  machines: Record<NodeId, { capacity: Resources; lastHeartbeat: number }>;
  deployments: Record<string, DeploymentSpec>;
  pods: Record<string, PodRecord>;
  counters: Record<string, number>;
  unschedulable: number;
}

export interface ControlPlaneOptions {
  readonly reconcileInterval?: number;
  readonly heartbeatTimeout?: number;
  readonly deployments?: ReadonlyArray<Deploy>;
}

type Ctx = Parameters<Protocol<ControlPlaneState, KubeMessage>["onMessage"]>[0];

export function controlPlane(
  options: ControlPlaneOptions = {},
): Protocol<ControlPlaneState, KubeMessage> {
  const reconcileInterval = options.reconcileInterval ?? 500;
  const heartbeatTimeout = options.heartbeatTimeout ?? 2000;

  function podsOf(state: ControlPlaneState, deployment: string): string[] {
    return Object.keys(state.pods).filter((id) => state.pods[id]?.deployment === deployment);
  }

  function machineViews(state: ControlPlaneState): MachineCapacity[] {
    return Object.entries(state.machines).map(([id, m]) => {
      let used = ZERO;
      for (const rec of Object.values(state.pods)) {
        if (rec.machineId === id) used = addRes(used, rec.request);
      }
      return { id, capacity: m.capacity, used };
    });
  }

  function reconcile(ctx: Ctx, state: ControlPlaneState): void {
    // 1. Converge replica counts for each deployment.
    for (const [name, spec] of Object.entries(state.deployments)) {
      const ids = podsOf(state, name);
      if (ids.length < spec.replicas) {
        for (let i = ids.length; i < spec.replicas; i++) {
          const n = (state.counters[name] ?? 0) + 1;
          state.counters[name] = n;
          state.pods[`${name}-${n}`] = { deployment: name, request: spec.request, machineId: null };
        }
      } else if (ids.length > spec.replicas) {
        for (const id of ids.slice(spec.replicas)) {
          const rec = state.pods[id];
          if (rec?.machineId) ctx.send(rec.machineId, { type: "kube-evict", podId: id });
          delete state.pods[id];
        }
      }
    }

    // 2. Bin-pack everything currently unassigned onto healthy machines.
    const pending: Pod[] = Object.entries(state.pods)
      .filter(([, rec]) => rec.machineId === null)
      .map(([id, rec]) => ({ id, deployment: rec.deployment, request: rec.request }));
    const { assignments, unschedulable } = placePods(machineViews(state), pending);
    for (const [podId, machineId] of assignments) {
      const rec = state.pods[podId];
      if (!rec) continue;
      rec.machineId = machineId;
      ctx.send(machineId, {
        type: "kube-assign",
        pod: { id: podId, deployment: rec.deployment, request: rec.request },
      });
    }
    state.unschedulable = unschedulable.length;
    if (unschedulable.length > 0) {
      ctx.log("warn", "pods cannot be scheduled (no capacity)", { count: unschedulable.length });
    }
  }

  function checkHealth(ctx: Ctx, state: ControlPlaneState): void {
    for (const [id, m] of Object.entries(state.machines)) {
      if (ctx.now - m.lastHeartbeat > heartbeatTimeout) {
        delete state.machines[id];
        let rescheduled = 0;
        for (const rec of Object.values(state.pods)) {
          if (rec.machineId === id) {
            rec.machineId = null; // becomes pending → rescheduled next reconcile
            rescheduled++;
          }
        }
        ctx.log("warn", "machine failed (missed heartbeats)", { machine: id, pods: rescheduled });
      }
    }
  }

  return {
    name: "control-plane",
    init(ctx) {
      const deployments: Record<string, DeploymentSpec> = {};
      for (const d of options.deployments ?? []) {
        deployments[d.name] = d.hpa
          ? { replicas: d.replicas, request: d.request, hpa: d.hpa }
          : { replicas: d.replicas, request: d.request };
      }
      ctx.setTimer(reconcileInterval, "reconcile");
      ctx.setTimer(heartbeatTimeout, "health");
      return { machines: {}, deployments, pods: {}, counters: {}, unschedulable: 0 };
    },
    onMessage(ctx, state, from, message) {
      switch (message.type) {
        case "kube-heartbeat":
          state.machines[from] = { capacity: message.capacity, lastHeartbeat: ctx.now };
          return state;
        case "kube-deploy":
          state.deployments[message.name] = message.hpa
            ? { replicas: message.replicas, request: message.request, hpa: message.hpa }
            : { replicas: message.replicas, request: message.request };
          return state;
        case "kube-load": {
          const spec = state.deployments[message.name];
          if (spec?.hpa) {
            spec.replicas = desiredReplicas(
              spec.replicas,
              message.utilization,
              spec.hpa.target,
              spec.hpa.min,
              spec.hpa.max,
            );
          }
          return state;
        }
        default:
          return state;
      }
    },
    onTimer(ctx, state, token) {
      if (token === "reconcile") {
        reconcile(ctx, state);
        ctx.setTimer(reconcileInterval, "reconcile");
      } else if (token === "health") {
        checkHealth(ctx, state);
        ctx.setTimer(heartbeatTimeout, "health");
      }
      return state;
    },
  };
}
