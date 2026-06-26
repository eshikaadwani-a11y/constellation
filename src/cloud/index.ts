/** Cloud infrastructure: a bin-packing scheduler and a Kubernetes-style control plane. */
export {
  type Resources,
  type Pod,
  type MachineCapacity,
  type PlacementResult,
  type PlacementStrategy,
  ZERO,
  addRes,
  subRes,
  fits,
  bestFit,
  firstFit,
  placePods,
  desiredReplicas,
} from "./scheduler.js";
export {
  controlPlane,
  kubelet,
  type KubeMessage,
  type KubeletState,
  type KubeletOptions,
  type ControlPlaneState,
  type ControlPlaneOptions,
} from "./orchestration.js";
