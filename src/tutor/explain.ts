/**
 * Plain-language explanations of a single node's current situation, for the
 * inspector's "why is this node doing that?" panel.
 */
import type { RaftState } from "../protocols/raft.js";

/** Explains, in one or two sentences, why a Raft node is in its current state. */
export function explainRaft(id: string, state: RaftState): string {
  const committed = state.commitIndex;
  const logLen = state.log.length;
  switch (state.role) {
    case "leader":
      return (
        `${id} is the leader for term ${state.currentTerm}. It has ${logLen} log ` +
        `${logLen === 1 ? "entry" : "entries"}, ${committed} of them committed, and is sending ` +
        `heartbeats to keep followers from starting an election.`
      );
    case "candidate":
      return (
        `${id} timed out without hearing from a leader, so it bumped to term ` +
        `${state.currentTerm} and is campaigning. It has ${state.votesGranted.length} ` +
        `${state.votesGranted.length === 1 ? "vote" : "votes"} so far and needs a majority to win.`
      );
    case "follower":
      return state.leaderId
        ? `${id} is following ${state.leaderId} in term ${state.currentTerm}. It resets its ` +
            `election timer on every heartbeat; if those stop, it will become a candidate.`
        : `${id} is a follower in term ${state.currentTerm} with no known leader. If its ` +
            `randomized election timer fires first, it will start the next election.`;
  }
}
