/**
 * The scheduler — the bin-packing heart of cloud orchestration.
 *
 * Pure, deterministic placement of resource-requesting pods onto capacity-bound
 * machines, mirroring how a Kubernetes scheduler reasons. The interesting
 * engineering is here: respecting capacity (no overcommit), packing densely
 * (best-fit, first-fit-decreasing) to free whole machines for autoscale-down,
 * and reporting what cannot be placed.
 *
 * This module has no engine or protocol dependency, so it is exhaustively
 * unit-tested in isolation; the control-plane protocol simply drives it.
 */

export interface Resources {
  readonly cpu: number;
  readonly memory: number;
}

export const ZERO: Resources = { cpu: 0, memory: 0 };

export const addRes = (a: Resources, b: Resources): Resources => ({
  cpu: a.cpu + b.cpu,
  memory: a.memory + b.memory,
});

export const subRes = (a: Resources, b: Resources): Resources => ({
  cpu: a.cpu - b.cpu,
  memory: a.memory - b.memory,
});

/** True if `request` fits within `free` on every dimension. */
export const fits = (free: Resources, request: Resources): boolean =>
  free.cpu >= request.cpu && free.memory >= request.memory;

export interface Pod {
  readonly id: string;
  /** The deployment this pod belongs to (for replica accounting). */
  readonly deployment: string;
  readonly request: Resources;
}

export interface MachineCapacity {
  readonly id: string;
  readonly capacity: Resources;
  /** Resources already committed on this machine. */
  readonly used: Resources;
}

const free = (m: MachineCapacity): Resources => subRes(m.capacity, m.used);

/** A scalar "size" used to rank leftover space; lower means a tighter fit. */
const magnitude = (r: Resources): number => r.cpu + r.memory;

/**
 * Best-fit: among machines that can host `request`, choose the one left with the
 * least slack, packing machines densely. Ties break by id for determinism.
 */
export function bestFit(machines: readonly MachineCapacity[], request: Resources): string | null {
  let chosen: { id: string; leftover: number } | null = null;
  for (const m of machines) {
    const f = free(m);
    if (!fits(f, request)) continue;
    const leftover = magnitude(subRes(f, request));
    if (
      chosen === null ||
      leftover < chosen.leftover ||
      (leftover === chosen.leftover && m.id < chosen.id)
    ) {
      chosen = { id: m.id, leftover };
    }
  }
  return chosen?.id ?? null;
}

/** First-fit: the first machine (in id order) that can host `request`. */
export function firstFit(machines: readonly MachineCapacity[], request: Resources): string | null {
  const ordered = [...machines].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const m of ordered) if (fits(free(m), request)) return m.id;
  return null;
}

export type PlacementStrategy = (
  machines: readonly MachineCapacity[],
  request: Resources,
) => string | null;

export interface PlacementResult {
  /** Pod id → machine id for everything that was placed. */
  readonly assignments: Map<string, string>;
  /** Pods that did not fit anywhere. */
  readonly unschedulable: Pod[];
}

/**
 * Places `pending` pods onto `machines` using first-fit-decreasing: largest pods
 * first (they are hardest to place), each onto the best-fit machine. Returns the
 * assignments plus anything that could not be scheduled.
 */
export function placePods(
  machines: readonly MachineCapacity[],
  pending: readonly Pod[],
  strategy: PlacementStrategy = bestFit,
): PlacementResult {
  // Work on a mutable copy of usage so we account for each placement.
  const usage = new Map<string, Resources>(machines.map((m) => [m.id, m.used]));
  const live = (): MachineCapacity[] =>
    machines.map((m) => ({ id: m.id, capacity: m.capacity, used: usage.get(m.id) as Resources }));

  const ordered = [...pending].sort(
    (a, b) => magnitude(b.request) - magnitude(a.request) || (a.id < b.id ? -1 : 1),
  );

  const assignments = new Map<string, string>();
  const unschedulable: Pod[] = [];
  for (const pod of ordered) {
    const target = strategy(live(), pod.request);
    if (target === null) {
      unschedulable.push(pod);
      continue;
    }
    assignments.set(pod.id, target);
    usage.set(target, addRes(usage.get(target) as Resources, pod.request));
  }
  return { assignments, unschedulable };
}

/**
 * Horizontal autoscaler: the replica count needed to bring average utilization
 * down to `targetUtilization`, given the current `currentReplicas` are running
 * at `currentUtilization`. Clamped to `[min, max]`. Mirrors the Kubernetes HPA
 * formula `ceil(replicas * current / target)`.
 */
export function desiredReplicas(
  currentReplicas: number,
  currentUtilization: number,
  targetUtilization: number,
  min: number,
  max: number,
): number {
  if (targetUtilization <= 0) return max;
  const desired = Math.ceil(currentReplicas * (currentUtilization / targetUtilization));
  return Math.min(max, Math.max(min, desired));
}
