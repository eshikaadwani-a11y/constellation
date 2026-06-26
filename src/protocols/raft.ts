/**
 * Raft consensus.
 *
 * A faithful implementation of the Raft algorithm (Ongaro & Ousterhout, 2014) as
 * a single {@link Protocol}: leader election with randomized timeouts, log
 * replication with the consistency check, commitment by majority, and the term
 * machinery that ties it all together. It implements the paper's safety
 * properties — Election Safety (at most one leader per term), Leader Append-Only,
 * Log Matching, and State Machine Safety.
 *
 * The protocol is pure with respect to the engine: it reacts to RPC messages and
 * timers and drives everything through `ctx`. Run it on the deterministic
 * scheduler and the entire election — every vote, every split, every retry — is
 * reproducible from the seed.
 *
 * Membership is taken from `ctx.peers` (a fixed cluster). Client commands arrive
 * as `propose` messages; a non-leader forwards them to the leader it knows.
 */
import type { Protocol } from "../engine/protocol.js";
import type { Message, NodeId, TimerId } from "../engine/types.js";

export type RaftRole = "follower" | "candidate" | "leader";

export interface LogEntry {
  readonly term: number;
  readonly command: unknown;
}

export interface RaftState {
  role: RaftRole;
  currentTerm: number;
  votedFor: NodeId | null;
  leaderId: NodeId | null;
  log: LogEntry[];
  commitIndex: number;
  votesGranted: NodeId[];
  nextIndex: Record<NodeId, number>;
  matchIndex: Record<NodeId, number>;
  electionTimerId: TimerId | null;
  heartbeatTimerId: TimerId | null;
}

interface RequestVote extends Message {
  type: "request-vote";
  term: number;
  candidateId: NodeId;
  lastLogIndex: number;
  lastLogTerm: number;
}
interface RequestVoteReply extends Message {
  type: "request-vote-reply";
  term: number;
  voteGranted: boolean;
}
interface AppendEntries extends Message {
  type: "append-entries";
  term: number;
  leaderId: NodeId;
  prevLogIndex: number;
  prevLogTerm: number;
  entries: LogEntry[];
  leaderCommit: number;
}
interface AppendEntriesReply extends Message {
  type: "append-entries-reply";
  term: number;
  success: boolean;
  matchIndex: number;
}
interface Propose extends Message {
  type: "propose";
  command: unknown;
}

export type RaftMessage =
  | RequestVote
  | RequestVoteReply
  | AppendEntries
  | AppendEntriesReply
  | Propose;

export interface RaftOptions {
  /** Lower bound of the randomized election timeout (virtual ms). */
  readonly electionTimeoutMin?: number;
  /** Upper bound of the randomized election timeout (virtual ms). */
  readonly electionTimeoutMax?: number;
  /** How often a leader sends heartbeats. Must be well below the election timeout. */
  readonly heartbeatInterval?: number;
}

// A minimal view of the context the helpers need, so they read cleanly.
type Ctx = Parameters<Protocol<RaftState, RaftMessage>["onMessage"]>[0];

const lastLogIndex = (s: RaftState): number => s.log.length;
const termAt = (s: RaftState, index: number): number =>
  index <= 0 || index > s.log.length ? 0 : (s.log[index - 1] as LogEntry).term;
const majority = (ctx: Ctx): number => Math.floor((ctx.peers.length + 1) / 2) + 1;

export function raft(options: RaftOptions = {}): Protocol<RaftState, RaftMessage> {
  const electionMin = options.electionTimeoutMin ?? 150;
  const electionMax = options.electionTimeoutMax ?? 300;
  const heartbeatInterval = options.heartbeatInterval ?? 50;

  function armElectionTimer(ctx: Ctx, s: RaftState): void {
    if (s.electionTimerId !== null) ctx.clearTimer(s.electionTimerId);
    s.electionTimerId = ctx.setTimer(ctx.randomInt(electionMin, electionMax), "election");
  }

  function armHeartbeat(ctx: Ctx, s: RaftState): void {
    s.heartbeatTimerId = ctx.setTimer(heartbeatInterval, "heartbeat");
  }

  function stepDown(ctx: Ctx, s: RaftState, term: number): void {
    s.currentTerm = term;
    s.role = "follower";
    s.votedFor = null;
    s.votesGranted = [];
    if (s.heartbeatTimerId !== null) {
      ctx.clearTimer(s.heartbeatTimerId);
      s.heartbeatTimerId = null;
    }
  }

  function startElection(ctx: Ctx, s: RaftState): void {
    s.role = "candidate";
    s.currentTerm += 1;
    s.votedFor = ctx.id;
    s.votesGranted = [ctx.id];
    s.leaderId = null;
    ctx.log("info", "starts election", { term: s.currentTerm });
    armElectionTimer(ctx, s);
    const req: RequestVote = {
      type: "request-vote",
      term: s.currentTerm,
      candidateId: ctx.id,
      lastLogIndex: lastLogIndex(s),
      lastLogTerm: termAt(s, lastLogIndex(s)),
    };
    for (const peer of ctx.peers) ctx.send(peer, req);
    if (s.votesGranted.length >= majority(ctx)) becomeLeader(ctx, s); // single-node cluster
  }

  function becomeLeader(ctx: Ctx, s: RaftState): void {
    s.role = "leader";
    s.leaderId = ctx.id;
    s.nextIndex = {};
    s.matchIndex = {};
    for (const peer of ctx.peers) {
      s.nextIndex[peer] = lastLogIndex(s) + 1;
      s.matchIndex[peer] = 0;
    }
    if (s.electionTimerId !== null) {
      ctx.clearTimer(s.electionTimerId);
      s.electionTimerId = null;
    }
    ctx.log("info", "becomes leader", { term: s.currentTerm });
    replicate(ctx, s);
    armHeartbeat(ctx, s);
  }

  function replicate(ctx: Ctx, s: RaftState): void {
    for (const peer of ctx.peers) {
      const ni = s.nextIndex[peer] ?? lastLogIndex(s) + 1;
      const prevLogIndex = ni - 1;
      const msg: AppendEntries = {
        type: "append-entries",
        term: s.currentTerm,
        leaderId: ctx.id,
        prevLogIndex,
        prevLogTerm: termAt(s, prevLogIndex),
        entries: s.log.slice(prevLogIndex),
        leaderCommit: s.commitIndex,
      };
      ctx.send(peer, msg);
    }
  }

  function advanceCommit(ctx: Ctx, s: RaftState): void {
    for (let n = lastLogIndex(s); n > s.commitIndex; n--) {
      if (termAt(s, n) !== s.currentTerm) continue; // Raft only commits current-term entries directly
      let count = 1; // the leader itself
      for (const peer of ctx.peers) if ((s.matchIndex[peer] ?? 0) >= n) count++;
      if (count >= majority(ctx)) {
        s.commitIndex = n;
        ctx.log("info", "advances commit index", { commitIndex: n });
        break;
      }
    }
  }

  function logUpToDate(s: RaftState, candIndex: number, candTerm: number): boolean {
    const myTerm = termAt(s, lastLogIndex(s));
    if (candTerm !== myTerm) return candTerm > myTerm;
    return candIndex >= lastLogIndex(s);
  }

  return {
    name: "raft",

    init(ctx) {
      const state: RaftState = {
        role: "follower",
        currentTerm: 0,
        votedFor: null,
        leaderId: null,
        log: [],
        commitIndex: 0,
        votesGranted: [],
        nextIndex: {},
        matchIndex: {},
        electionTimerId: null,
        heartbeatTimerId: null,
      };
      armElectionTimer(ctx, state);
      return state;
    },

    onTimer(ctx, s, token) {
      if (token === "election" && s.role !== "leader") {
        startElection(ctx, s);
      } else if (token === "heartbeat" && s.role === "leader") {
        replicate(ctx, s);
        armHeartbeat(ctx, s);
      }
      return s;
    },

    onMessage(ctx, s, from, message) {
      switch (message.type) {
        case "request-vote": {
          if (message.term > s.currentTerm) stepDown(ctx, s, message.term);
          const grant =
            message.term === s.currentTerm &&
            (s.votedFor === null || s.votedFor === message.candidateId) &&
            logUpToDate(s, message.lastLogIndex, message.lastLogTerm);
          if (grant) {
            s.votedFor = message.candidateId;
            armElectionTimer(ctx, s);
          }
          ctx.send(from, {
            type: "request-vote-reply",
            term: s.currentTerm,
            voteGranted: grant,
          } satisfies RequestVoteReply);
          return s;
        }

        case "request-vote-reply": {
          if (message.term > s.currentTerm) {
            stepDown(ctx, s, message.term);
            return s;
          }
          if (s.role !== "candidate" || message.term !== s.currentTerm || !message.voteGranted) {
            return s;
          }
          if (!s.votesGranted.includes(from)) s.votesGranted.push(from);
          if (s.votesGranted.length >= majority(ctx)) becomeLeader(ctx, s);
          return s;
        }

        case "append-entries": {
          if (message.term < s.currentTerm) {
            ctx.send(from, {
              type: "append-entries-reply",
              term: s.currentTerm,
              success: false,
              matchIndex: 0,
            } satisfies AppendEntriesReply);
            return s;
          }
          // Recognize the leader for this term.
          if (message.term > s.currentTerm) stepDown(ctx, s, message.term);
          s.role = "follower";
          s.leaderId = message.leaderId;
          if (s.heartbeatTimerId !== null) {
            ctx.clearTimer(s.heartbeatTimerId);
            s.heartbeatTimerId = null;
          }
          armElectionTimer(ctx, s);

          // Log consistency check.
          if (
            message.prevLogIndex > 0 &&
            (lastLogIndex(s) < message.prevLogIndex ||
              termAt(s, message.prevLogIndex) !== message.prevLogTerm)
          ) {
            ctx.send(from, {
              type: "append-entries-reply",
              term: s.currentTerm,
              success: false,
              matchIndex: 0,
            } satisfies AppendEntriesReply);
            return s;
          }

          // Append any new entries, truncating on conflict.
          for (let i = 0; i < message.entries.length; i++) {
            const pos = message.prevLogIndex + i; // 0-based index into log
            const incoming = message.entries[i] as LogEntry;
            const existing = s.log[pos];
            if (existing && existing.term !== incoming.term) s.log.length = pos;
            if (!s.log[pos]) s.log.push(incoming);
          }
          if (message.leaderCommit > s.commitIndex) {
            s.commitIndex = Math.min(message.leaderCommit, lastLogIndex(s));
          }
          ctx.send(from, {
            type: "append-entries-reply",
            term: s.currentTerm,
            success: true,
            matchIndex: message.prevLogIndex + message.entries.length,
          } satisfies AppendEntriesReply);
          return s;
        }

        case "append-entries-reply": {
          if (message.term > s.currentTerm) {
            stepDown(ctx, s, message.term);
            return s;
          }
          if (s.role !== "leader" || message.term !== s.currentTerm) return s;
          if (message.success) {
            s.matchIndex[from] = message.matchIndex;
            s.nextIndex[from] = message.matchIndex + 1;
            advanceCommit(ctx, s);
          } else {
            s.nextIndex[from] = Math.max(1, (s.nextIndex[from] ?? 1) - 1);
          }
          return s;
        }

        case "propose": {
          if (s.role === "leader") {
            s.log.push({ term: s.currentTerm, command: message.command });
            ctx.log("info", "accepts client command", { index: lastLogIndex(s) });
            replicate(ctx, s);
          } else if (s.leaderId !== null) {
            ctx.send(s.leaderId, message); // forward to the leader we know
          }
          return s;
        }
      }
    },
  };
}

/** Convenience: the id of the current leader, if exactly one node believes it leads. */
export function leaderOf(states: ReadonlyMap<NodeId, RaftState>): NodeId | null {
  let leader: NodeId | null = null;
  for (const [id, state] of states) {
    if (state.role === "leader") {
      if (leader !== null) return null; // ambiguous
      leader = id;
    }
  }
  return leader;
}
