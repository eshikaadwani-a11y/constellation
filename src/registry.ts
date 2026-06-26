/**
 * The protocol registry.
 *
 * A name → factory map that lets protocols be referenced by string — the key to
 * declarative, serializable scenarios (you can save "5 raft nodes, seed 42" as
 * data) and to extensibility (register your own protocol and it is immediately
 * available to the scenario loader and the UI). The engine itself does not
 * depend on this; it lives one layer up, alongside the protocol library.
 */
import type { Message } from "./engine/types.js";
import type { Protocol } from "./engine/protocol.js";
import { raft } from "./protocols/raft.js";
import { gossip } from "./protocols/gossip.js";
import {
  twoPhaseCommitCoordinator,
  twoPhaseCommitParticipant,
} from "./protocols/twoPhaseCommit.js";
import { controlPlane, kubelet } from "./cloud/orchestration.js";
import type { Resources } from "./cloud/scheduler.js";

export type ProtocolOptions = Record<string, unknown>;
export type ProtocolFactory = (options: ProtocolOptions) => Protocol<unknown, Message>;

export class ProtocolRegistry {
  private readonly factories = new Map<string, ProtocolFactory>();

  register(name: string, factory: ProtocolFactory): this {
    this.factories.set(name, factory);
    return this;
  }

  has(name: string): boolean {
    return this.factories.has(name);
  }

  names(): string[] {
    return [...this.factories.keys()];
  }

  create(name: string, options: ProtocolOptions = {}): Protocol<unknown, Message> {
    const factory = this.factories.get(name);
    if (!factory) throw new Error(`unknown protocol: ${name}`);
    return factory(options);
  }
}

// A small adapter so strongly-typed factories slot into the loosely-typed registry.
const as = <T>(value: unknown): T => value as T;

/** A registry pre-loaded with Constellation's built-in protocols. */
export function defaultRegistry(): ProtocolRegistry {
  return new ProtocolRegistry()
    .register("raft", (o) => raft(o) as Protocol<unknown, Message>)
    .register("gossip", (o) => gossip(o) as Protocol<unknown, Message>)
    .register("2pc-coordinator", (o) => twoPhaseCommitCoordinator(o) as Protocol<unknown, Message>)
    .register(
      "2pc-participant",
      (o) =>
        twoPhaseCommitParticipant(as<boolean | undefined>(o["vote"]) ?? true) as Protocol<
          unknown,
          Message
        >,
    )
    .register("control-plane", (o) => controlPlane(o) as Protocol<unknown, Message>)
    .register(
      "kubelet",
      (o) =>
        kubelet(
          as<string>(o["controlPlane"]),
          as<Resources>(o["capacity"]) ?? { cpu: 8, memory: 16 },
          o,
        ) as Protocol<unknown, Message>,
    );
}
