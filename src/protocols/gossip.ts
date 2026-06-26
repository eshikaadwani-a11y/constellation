/**
 * Epidemic gossip — anti-entropy dissemination.
 *
 * Each node periodically picks a random peer and pushes everything it knows.
 * Information spreads like an infection: from one informed node it reaches the
 * whole cluster in O(log N) rounds with overwhelming probability. This is how
 * real systems propagate membership and metadata (Cassandra, Consul, SWIM).
 *
 * The store is a simple last-writer-wins key/value map versioned per key, so
 * concurrent updates converge deterministically.
 */
import type { Protocol } from "../engine/protocol.js";
import type { Message, NodeId } from "../engine/types.js";

interface Entry {
  readonly value: unknown;
  readonly version: number;
}

interface SyncMessage extends Message {
  type: "gossip-sync";
  entries: Record<string, Entry>;
}

export type GossipMessage = SyncMessage;

export interface GossipState {
  store: Record<string, Entry>;
}

export interface GossipOptions {
  /** Mean interval between gossip rounds (virtual ms). */
  readonly interval?: number;
}

/** Merges incoming entries into the store, keeping the highest version per key. */
function mergeEntries(store: Record<string, Entry>, incoming: Record<string, Entry>): boolean {
  let changed = false;
  for (const [key, entry] of Object.entries(incoming)) {
    const current = store[key];
    if (!current || entry.version > current.version) {
      store[key] = entry;
      changed = true;
    }
  }
  return changed;
}

export function gossip(options: GossipOptions = {}): Protocol<GossipState, GossipMessage> {
  const interval = options.interval ?? 300;
  return {
    name: "gossip",
    init(ctx) {
      ctx.setTimer(ctx.randomInt(Math.floor(interval / 2), interval), "round");
      return { store: {} };
    },
    onMessage(ctx, state, _from, message) {
      const changed = mergeEntries(state.store, message.entries);
      if (changed) ctx.log("info", "learned new state", { keys: Object.keys(state.store).length });
      return state;
    },
    onTimer(ctx, state) {
      ctx.setTimer(ctx.randomInt(Math.floor(interval / 2), interval), "round");
      if (ctx.peers.length > 0 && Object.keys(state.store).length > 0) {
        const peer = ctx.peers[ctx.randomInt(0, ctx.peers.length - 1)] as NodeId;
        ctx.send(peer, { type: "gossip-sync", entries: { ...state.store } });
      }
      return state;
    },
  };
}

/** Builds the message a client injects to seed a key/value into the cluster. */
export function gossipSet(key: string, value: unknown, version = 1): GossipMessage {
  return { type: "gossip-sync", entries: { [key]: { value, version } } };
}
