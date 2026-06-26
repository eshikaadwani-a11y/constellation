# Cloud orchestration

Constellation models a container orchestrator the way Kubernetes works, built entirely from engine
protocols so it inherits replay, chaos, and observability.

## Pieces

- **Scheduler** ([`src/cloud/scheduler.ts`](../src/cloud/scheduler.ts)) — a pure, deterministic
  bin-packer. It places resource-requesting pods onto capacity-bound machines using
  first-fit-decreasing with a best-fit machine choice, never overcommits, and reports what cannot be
  placed. Unit-tested in isolation.
- **Kubelet** — a machine node. It advertises capacity through periodic heartbeats and runs the pods
  the control plane assigns.
- **Control plane** — a node that reconciles desired vs. actual state on a loop: it converges replica
  counts, bin-packs pending pods, and detects dead machines by missed heartbeats, rescheduling their
  pods.
- **Horizontal autoscaler** — adjusts a deployment's replica count from a load signal using the
  Kubernetes HPA formula, clamped to `[min, max]`.

## The reconcile loop

```
every reconcileInterval:
  for each deployment:
    create/delete pods until pod count == desired replicas
  pending = pods with no machine
  assignments = binPack(healthy machines, pending)
  send "assign" to each chosen machine; mark the rest unschedulable

every heartbeatTimeout:
  for each machine with no recent heartbeat:
    drop it; mark its pods pending  → rescheduled on the next reconcile
```

## Why it's interesting

Failure detection is real, not faked: crashing a kubelet (with the chaos tools or `sim.crash`)
simply stops its heartbeats. The control plane notices the silence, declares the machine dead, and
reschedules its pods onto survivors — and because the whole thing runs on the deterministic engine,
you can scrub the timeline to the exact reconcile where the pods moved, and replay it identically.

```ts
const sim = new Simulation({ seed: 1 });
sim.addNode(
  "control",
  controlPlane({
    deployments: [
      { type: "kube-deploy", name: "web", replicas: 6, request: { cpu: 2, memory: 4 } },
    ],
  }),
);
for (let i = 0; i < 3; i++) sim.addNode(`m${i + 1}`, kubelet("control", { cpu: 8, memory: 16 }));
sim.run({ until: 4000 }); // 6 pods bin-packed across 3 machines
sim.crash("m1"); // its 2 pods will be rescheduled onto m2/m3
sim.run({ until: 12000 });
```

Open the **Cloud orchestration** scenario in the lab to watch it live: machines are coloured by CPU
utilization, the control plane bin-packs under oscillating load (driving the autoscaler), and
crashing a machine triggers visible reschedule traffic.
