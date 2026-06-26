/**
 * The systems tutor — a deterministic reasoning engine.
 *
 * Rather than wrapping a language model (which would be non-deterministic and
 * prone to confident nonsense about a system it cannot see), the tutor analyzes
 * the recorded event stream directly and explains, causally, *why* the system
 * behaved as it did: why a node won an election, why a partition stalled
 * progress, when an entry became durable.
 *
 * It is a set of small, pure {@link Analyzer} functions over the event stream,
 * so its explanations are reproducible and unit-tested — and it remains a clean
 * seam where an LLM could later add natural-language phrasing on top of the
 * structured, ground-truth insights produced here.
 */
import type { SimEvent } from "../engine/events.js";
import type { NodeId, SimTime } from "../engine/types.js";

export type InsightSeverity = "info" | "good" | "warning" | "critical";
export type InsightCategory = "election" | "replication" | "fault" | "network";

export interface Insight {
  readonly id: string;
  readonly time: SimTime;
  readonly severity: InsightSeverity;
  readonly category: InsightCategory;
  readonly title: string;
  readonly detail: string;
  readonly nodes: NodeId[];
}

export type Analyzer = (events: readonly SimEvent[]) => Insight[];

const majorityOf = (clusterSize: number): number => Math.floor(clusterSize / 2) + 1;

/** Counts nodes present at the end of the stream (membership is fixed). */
function clusterSize(events: readonly SimEvent[]): number {
  let n = 0;
  for (const e of events) if (e.kind === "node:added") n++;
  return n;
}

/**
 * Explains each leadership win: which term, how many votes, and why that was
 * enough — plus flags election storms where nobody can win.
 */
export const electionAnalyzer: Analyzer = (events) => {
  const size = clusterSize(events);
  const majority = majorityOf(size);
  const votesByTerm = new Map<number, Map<NodeId, number>>();
  const electionsInWindow: SimTime[] = [];
  const insights: Insight[] = [];
  let counter = 0;

  for (const e of events) {
    if (e.kind === "message:delivered" && e.envelope.message.type === "request-vote-reply") {
      const granted = (e.envelope.message as { voteGranted?: boolean }).voteGranted === true;
      const term = (e.envelope.message as { term?: number }).term ?? 0;
      if (granted) {
        const forTerm = votesByTerm.get(term) ?? new Map<NodeId, number>();
        forTerm.set(e.envelope.to, (forTerm.get(e.envelope.to) ?? 0) + 1);
        votesByTerm.set(term, forTerm);
      }
    }

    if (e.kind === "log" && e.message === "starts election") {
      electionsInWindow.push(e.time);
      // Keep only elections within the last 1s.
      while (electionsInWindow.length > 0 && e.time - (electionsInWindow[0] as number) > 1000) {
        electionsInWindow.shift();
      }
      if (electionsInWindow.length >= Math.max(3, size) && size > 1) {
        insights.push({
          id: `election-storm-${counter++}`,
          time: e.time,
          severity: "warning",
          category: "election",
          title: "Election storm",
          detail:
            `${electionsInWindow.length} elections started within a second. Candidates keep ` +
            `splitting the vote, so no one reaches a ${majority}-node majority. Randomized ` +
            `timeouts normally break this; persistent storms point to a partition or an ` +
            `unreachable majority.`,
          nodes: [e.nodeId],
        });
        electionsInWindow.length = 0;
      }
    }

    if (e.kind === "log" && e.message === "becomes leader") {
      const term = (e.fields.term as number) ?? 0;
      const votes = (votesByTerm.get(term)?.get(e.nodeId) ?? 0) + 1; // +1 for the self-vote
      insights.push({
        id: `leader-${counter++}`,
        time: e.time,
        severity: "good",
        category: "election",
        title: `${e.nodeId} elected leader (term ${term})`,
        detail:
          `${e.nodeId} collected ${votes} of ${size} votes — at or above the ${majority}-vote ` +
          `majority — so it can now safely accept and replicate client commands for term ${term}.`,
        nodes: [e.nodeId],
      });
    }
  }
  return insights;
};

/** Explains commitment: an entry replicated to a majority is now durable. */
export const replicationAnalyzer: Analyzer = (events) => {
  const insights: Insight[] = [];
  let maxCommit = 0;
  let counter = 0;
  for (const e of events) {
    if (e.kind === "log" && e.message === "advances commit index") {
      const index = (e.fields.commitIndex as number) ?? 0;
      if (index > maxCommit) {
        maxCommit = index;
        insights.push({
          id: `commit-${counter++}`,
          time: e.time,
          severity: "good",
          category: "replication",
          title: `Log entry ${index} committed`,
          detail:
            `${e.nodeId} confirmed log index ${index} is stored on a majority of nodes. It is ` +
            `now durable: it will survive the failure of any minority and will never be ` +
            `overwritten, even across leader changes.`,
          nodes: [e.nodeId],
        });
      }
    }
  }
  return insights;
};

/** Explains crashes and restarts, escalating when the victim was the leader. */
export const faultAnalyzer: Analyzer = (events) => {
  const insights: Insight[] = [];
  let leader: NodeId | null = null;
  let counter = 0;
  for (const e of events) {
    if (e.kind === "log" && e.message === "becomes leader") leader = e.nodeId;
    if (e.kind === "node:crashed") {
      const wasLeader = e.nodeId === leader;
      insights.push({
        id: `crash-${counter++}`,
        time: e.time,
        severity: wasLeader ? "critical" : "warning",
        category: "fault",
        title: wasLeader ? `Leader ${e.nodeId} crashed` : `${e.nodeId} crashed`,
        detail: wasLeader
          ? `The leader stopped responding. Followers will miss heartbeats, time out, and start ` +
            `a new election; progress pauses until a new leader emerges with a higher term.`
          : `A follower stopped responding. The cluster keeps working as long as a majority ` +
            `remains alive.`,
        nodes: [e.nodeId],
      });
      if (wasLeader) leader = null;
    }
    if (e.kind === "node:restarted") {
      insights.push({
        id: `restart-${counter++}`,
        time: e.time,
        severity: "info",
        category: "fault",
        title: `${e.nodeId} restarted`,
        detail:
          `${e.nodeId} is back. It rejoins as a follower and catches up from the current leader; ` +
          `if it missed entries, the leader backfills them via the log-consistency check.`,
        nodes: [e.nodeId],
      });
    }
  }
  return insights;
};

/** Explains operator-induced network faults and their consequences. */
export const networkAnalyzer: Analyzer = (events) => {
  const insights: Insight[] = [];
  let counter = 0;
  for (const e of events) {
    if (e.kind !== "action") continue;
    if (e.label.startsWith("chaos: partition")) {
      insights.push({
        id: `net-${counter++}`,
        time: e.time,
        severity: "warning",
        category: "network",
        title: "Network partition",
        detail:
          `The cluster was split. A side holding a majority can still elect a leader and commit; ` +
          `any side without a majority cannot make progress and will spin in elections until the ` +
          `partition heals — the CAP theorem in action.`,
        nodes: [],
      });
    } else if (e.label.startsWith("chaos: packet loss")) {
      insights.push({
        id: `net-${counter++}`,
        time: e.time,
        severity: "warning",
        category: "network",
        title: "Packet loss introduced",
        detail:
          `Messages are now dropped at random. Protocols that retry (heartbeats, vote requests) ` +
          `degrade gracefully but slow down; throughput falls as effort is wasted on lost packets.`,
        nodes: [],
      });
    }
  }
  return insights;
};

export const DEFAULT_ANALYZERS: Analyzer[] = [
  electionAnalyzer,
  replicationAnalyzer,
  faultAnalyzer,
  networkAnalyzer,
];

/** Runs the analyzers over an event stream and returns insights in time order. */
export function analyze(
  events: readonly SimEvent[],
  analyzers: Analyzer[] = DEFAULT_ANALYZERS,
): Insight[] {
  const all = analyzers.flatMap((a) => a(events));
  return all.sort((x, y) => x.time - y.time || x.id.localeCompare(y.id));
}
