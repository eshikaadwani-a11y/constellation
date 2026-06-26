/** The networking layer: latency models and a lossy, partitionable network. */
export {
  type LatencyModel,
  constantLatency,
  uniformLatency,
  normalLatency,
  exponentialLatency,
} from "./latency.js";
export { Network, type NetworkOptions, type PartitionWindow } from "./network.js";
