/**
 * A unified activity journal.
 *
 * Protocol log lines are first-class events, but operators also care about
 * drops, crashes, and restarts. {@link buildJournal} merges them into a single
 * filterable, severity-tagged stream — the backing data for the lab's log view.
 */
import type { SimEvent } from "../engine/events.js";
import type { LogLevel, NodeId, SimTime } from "../engine/types.js";

export interface JournalEntry {
  readonly seq: number;
  readonly time: SimTime;
  readonly level: LogLevel;
  readonly nodeId: NodeId | null;
  readonly message: string;
  readonly fields: Record<string, unknown>;
}

export interface JournalFilter {
  readonly minLevel?: LogLevel;
  readonly node?: NodeId;
  /** Case-insensitive substring match against the message. */
  readonly text?: string;
}

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Merges protocol logs and notable lifecycle events into one journal. */
export function buildJournal(
  events: readonly SimEvent[],
  filter: JournalFilter = {},
): JournalEntry[] {
  const out: JournalEntry[] = [];
  for (const e of events) {
    let entry: JournalEntry | null = null;
    switch (e.kind) {
      case "log":
        entry = {
          seq: e.seq,
          time: e.time,
          level: e.level,
          nodeId: e.nodeId,
          message: e.message,
          fields: e.fields,
        };
        break;
      case "node:crashed":
        entry = mk(e.seq, e.time, "warn", e.nodeId, "node crashed");
        break;
      case "node:restarted":
        entry = mk(e.seq, e.time, "info", e.nodeId, "node restarted");
        break;
      case "message:dropped":
        entry = mk(e.seq, e.time, "warn", e.envelope.from, `message dropped (${e.reason})`, {
          to: e.envelope.to,
          type: e.envelope.message.type,
        });
        break;
      default:
        break;
    }
    if (entry && passes(entry, filter)) out.push(entry);
  }
  return out;
}

function mk(
  seq: number,
  time: SimTime,
  level: LogLevel,
  nodeId: NodeId | null,
  message: string,
  fields: Record<string, unknown> = {},
): JournalEntry {
  return { seq, time, level, nodeId, message, fields };
}

function passes(entry: JournalEntry, filter: JournalFilter): boolean {
  if (filter.minLevel && LEVEL_RANK[entry.level] < LEVEL_RANK[filter.minLevel]) return false;
  if (filter.node && entry.nodeId !== filter.node) return false;
  if (filter.text && !entry.message.toLowerCase().includes(filter.text.toLowerCase())) return false;
  return true;
}
