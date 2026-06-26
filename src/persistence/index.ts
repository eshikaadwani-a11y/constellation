/** Persistence: reproducible scenario specs and event-log export/import. */
export {
  buildSimulation,
  serializeScenario,
  parseScenario,
  type ScenarioSpec,
  type NodeSpec,
  type EventSpec,
  type NetworkSpec,
  type LatencySpec,
  type BuiltScenario,
} from "./scenario.js";
export { serializeEvents, parseEvents, type EventLogFile } from "./eventLog.js";
