/** The simulation engine: scheduler, node runtime, and plugin contracts. */
export type { NodeId, SimTime, TimerId, LogLevel, Message, Envelope } from "./types.js";
export type { NodeContext, Protocol } from "./protocol.js";
export type { SimEvent, SimEventKind, Observer } from "./events.js";
export type { Transport, TransportDecision } from "./transport.js";
export { FixedLatencyTransport } from "./transport.js";
export {
  Simulation,
  type SimulationOptions,
  type RunOptions,
  type RunResult,
} from "./simulation.js";
