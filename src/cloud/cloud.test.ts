import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../engine/simulation.js";
import { Network } from "../network/network.js";
import { constantLatency } from "../network/latency.js";
import type { NodeId } from "../engine/index.js";
import {
  bestFit,
  fits,
  placePods,
  desiredReplicas,
  type MachineCapacity,
  type Pod,
  type Resources,
} from "./scheduler.js";
import {
  controlPlane,
  kubelet,
  type ControlPlaneState,
  type KubeletState,
} from "./orchestration.js";

const r = (cpu: number, memory: number): Resources => ({ cpu, memory });

// --- Scheduler (pure) ------------------------------------------------------

test("fits respects every resource dimension", () => {
  assert.equal(fits(r(4, 8), r(2, 8)), true);
  assert.equal(fits(r(4, 8), r(2, 9)), false); // memory exceeds
});

test("best-fit packs into the tightest machine", () => {
  const machines: MachineCapacity[] = [
    { id: "big", capacity: r(16, 32), used: r(0, 0) },
    { id: "snug", capacity: r(4, 8), used: r(2, 4) }, // 2cpu/4mem free — exact fit
  ];
  assert.equal(bestFit(machines, r(2, 4)), "snug");
});

test("placePods never overcommits capacity", () => {
  const machines: MachineCapacity[] = [{ id: "m1", capacity: r(4, 8), used: r(0, 0) }];
  const pods: Pod[] = [
    { id: "a", deployment: "d", request: r(2, 4) },
    { id: "b", deployment: "d", request: r(2, 4) },
    { id: "c", deployment: "d", request: r(2, 4) }, // won't fit
  ];
  const result = placePods(machines, pods);
  assert.equal(result.assignments.size, 2);
  assert.equal(result.unschedulable.length, 1);
});

test("placePods bin-packs onto the fewest machines", () => {
  const machines: MachineCapacity[] = [
    { id: "m1", capacity: r(8, 16), used: r(0, 0) },
    { id: "m2", capacity: r(8, 16), used: r(0, 0) },
  ];
  const pods: Pod[] = Array.from({ length: 4 }, (_, i) => ({
    id: `p${i}`,
    deployment: "d",
    request: r(2, 4),
  }));
  const result = placePods(machines, pods);
  const usedMachines = new Set(result.assignments.values());
  assert.equal(usedMachines.size, 1, "four 2-cpu pods fit on one 8-cpu machine");
});

test("HPA scales replicas toward the utilization target", () => {
  assert.equal(desiredReplicas(2, 90, 50, 1, 10), 4); // ceil(2 * 90/50)
  assert.equal(desiredReplicas(4, 10, 50, 1, 10), 1); // scale down, clamped to min
  assert.equal(desiredReplicas(2, 1000, 50, 1, 6), 6); // clamped to max
});

// --- Orchestration on the engine -------------------------------------------

function cluster(
  deployments: Parameters<typeof controlPlane>[0],
  machines = 3,
): { sim: Simulation; ids: NodeId[] } {
  const sim = new Simulation({ seed: 1, transport: new Network({ latency: constantLatency(10) }) });
  sim.addNode(
    "control",
    controlPlane({ reconcileInterval: 300, heartbeatTimeout: 1500, ...deployments }),
  );
  const ids: NodeId[] = [];
  for (let i = 0; i < machines; i++) {
    const id = `m${i + 1}`;
    ids.push(id);
    sim.addNode(id, kubelet("control", r(8, 16)));
  }
  return { sim, ids };
}

test("the control plane schedules a deployment across machines", () => {
  const { sim, ids } = cluster({
    deployments: [{ type: "kube-deploy", name: "web", replicas: 6, request: r(2, 4) }],
  });
  sim.run({ until: 4000 });

  let scheduled = 0;
  for (const id of ids) scheduled += Object.keys(sim.stateOf<KubeletState>(id)?.pods ?? {}).length;
  assert.equal(scheduled, 6, "all six replicas should be placed");
  assert.equal(sim.stateOf<ControlPlaneState>("control")?.unschedulable, 0);
});

test("kubelets never exceed their capacity", () => {
  const { sim, ids } = cluster({
    deployments: [{ type: "kube-deploy", name: "web", replicas: 12, request: r(2, 4) }],
  });
  sim.run({ until: 5000 });
  for (const id of ids) {
    const s = sim.stateOf<KubeletState>(id);
    assert.ok((s?.used.cpu ?? 0) <= 8, `${id} cpu overcommitted`);
    assert.ok((s?.used.memory ?? 0) <= 16, `${id} memory overcommitted`);
  }
});

test("a crashed machine's pods are rescheduled elsewhere", () => {
  const { sim, ids } = cluster({
    deployments: [{ type: "kube-deploy", name: "web", replicas: 6, request: r(2, 4) }],
  });
  sim.run({ until: 4000 });
  const victim = ids[0] as NodeId;
  const before = Object.keys(sim.stateOf<KubeletState>(victim)?.pods ?? {}).length;
  assert.ok(before > 0, "victim should be running pods before the crash");

  sim.crash(victim); // stops heartbeats → control plane will detect failure
  sim.run({ until: 12000 });

  let live = 0;
  for (const id of ids) {
    if (id === victim) continue;
    live += Object.keys(sim.stateOf<KubeletState>(id)?.pods ?? {}).length;
  }
  assert.equal(live, 6, "all replicas should be rescheduled onto the surviving machines");
});

test("HPA grows the deployment under load", () => {
  const { sim, ids } = cluster({
    deployments: [
      {
        type: "kube-deploy",
        name: "web",
        replicas: 2,
        request: r(1, 2),
        hpa: { min: 2, max: 8, target: 50 },
      },
    ],
  });
  sim.run({ until: 2000 });
  sim.inject("control", { type: "kube-load", name: "web", utilization: 95 }, "client");
  sim.run({ until: 8000 });

  let pods = 0;
  for (const id of ids) pods += Object.keys(sim.stateOf<KubeletState>(id)?.pods ?? {}).length;
  assert.ok(pods > 2, `load should have scaled the deployment up, got ${pods} pods`);
  assert.ok(pods <= 8, "must respect the HPA maximum");
});
