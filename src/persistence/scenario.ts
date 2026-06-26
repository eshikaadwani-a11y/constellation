/**
 * Declarative, serializable scenarios — persistence via reproducibility.
 *
 * Because a run is a pure function of its inputs, a whole experiment can be
 * saved as a tiny recipe — a seed, a list of nodes (referenced by protocol
 * name), the network config, and a schedule of client requests and faults —
 * rather than a giant event dump. Loading the recipe reproduces the run
 * bit-for-bit. This is event sourcing applied to the *inputs*: the smallest
 * possible save file that fully determines the output.
 */
import { Simulation } from "../engine/simulation.js";
import type { Message, NodeId } from "../engine/types.js";
import { Network, type NetworkOptions } from "../network/network.js";
import {
  constantLatency,
  exponentialLatency,
  normalLatency,
  uniformLatency,
  type LatencyModel,
} from "../network/latency.js";
import { Chaos } from "../chaos/chaos.js";
import { defaultRegistry, type ProtocolRegistry } from "../registry.js";

export type LatencySpec =
  | { readonly kind: "constant"; readonly ms: number }
  | { readonly kind: "uniform"; readonly min: number; readonly max: number }
  | { readonly kind: "normal"; readonly mean: number; readonly stdDev: number }
  | { readonly kind: "exponential"; readonly mean: number };

export interface NetworkSpec {
  readonly latency?: LatencySpec;
  readonly lossRate?: number;
}

export interface NodeSpec {
  readonly id: NodeId;
  readonly protocol: string;
  readonly options?: Record<string, unknown>;
}

export type EventSpec =
  | {
      readonly at: number;
      readonly kind: "inject";
      readonly to: NodeId;
      readonly message: Message;
      readonly from?: NodeId;
    }
  | {
      readonly at: number;
      readonly kind: "crash";
      readonly node: NodeId;
      readonly duration?: number;
    }
  | {
      readonly at: number;
      readonly kind: "partition";
      readonly side: NodeId[];
      readonly duration?: number;
    }
  | {
      readonly at: number;
      readonly kind: "loss";
      readonly rate: number;
      readonly duration: number;
    };

export interface ScenarioSpec {
  readonly version: 1;
  readonly name?: string;
  readonly seed: number;
  readonly network?: NetworkSpec;
  readonly nodes: NodeSpec[];
  readonly events?: EventSpec[];
}

function latencyFromSpec(spec: LatencySpec | undefined): LatencyModel | undefined {
  if (!spec) return undefined;
  switch (spec.kind) {
    case "constant":
      return constantLatency(spec.ms);
    case "uniform":
      return uniformLatency(spec.min, spec.max);
    case "normal":
      return normalLatency(spec.mean, spec.stdDev);
    case "exponential":
      return exponentialLatency(spec.mean);
  }
}

export interface BuiltScenario {
  readonly sim: Simulation;
  readonly network: Network;
}

/** Builds a runnable simulation from a spec. Deterministic: same spec → same run. */
export function buildSimulation(
  spec: ScenarioSpec,
  registry: ProtocolRegistry = defaultRegistry(),
): BuiltScenario {
  const latency = latencyFromSpec(spec.network?.latency);
  const netOptions: NetworkOptions = {
    ...(latency ? { latency } : {}),
    ...(spec.network?.lossRate !== undefined ? { lossRate: spec.network.lossRate } : {}),
  };
  const network = new Network(netOptions);
  const sim = new Simulation({ seed: spec.seed, transport: network });

  for (const node of spec.nodes) {
    sim.addNode(node.id, registry.create(node.protocol, node.options ?? {}));
  }

  const chaos = new Chaos(sim, network);
  for (const event of spec.events ?? []) {
    switch (event.kind) {
      case "inject":
        sim.scheduleAt(
          event.at,
          () => sim.inject(event.to, event.message, event.from),
          `client: ${event.message.type}`,
        );
        break;
      case "crash":
        chaos.crash(event.node, event.at, event.duration);
        break;
      case "partition":
        chaos.partition(event.side, event.at, event.duration);
        break;
      case "loss":
        chaos.lossWindow(event.rate, event.at, event.duration);
        break;
    }
  }
  return { sim, network };
}

/** Serializes a scenario spec to pretty JSON. */
export function serializeScenario(spec: ScenarioSpec): string {
  return JSON.stringify(spec, null, 2);
}

/** Parses and validates a scenario spec from JSON. Throws on an unknown version. */
export function parseScenario(json: string): ScenarioSpec {
  const value = JSON.parse(json) as ScenarioSpec;
  if (value.version !== 1) throw new Error(`unsupported scenario version: ${value.version}`);
  if (!Array.isArray(value.nodes)) throw new Error("scenario is missing a nodes array");
  if (typeof value.seed !== "number") throw new Error("scenario is missing a numeric seed");
  return value;
}
