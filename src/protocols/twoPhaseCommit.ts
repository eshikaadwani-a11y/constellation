/**
 * Two-phase commit (2PC) — the classic atomic-commitment protocol for
 * distributed transactions.
 *
 * Phase 1 (voting): the coordinator asks every participant to PREPARE; each
 * votes yes (it can commit) or no. Phase 2 (decision): if *all* voted yes the
 * coordinator broadcasts COMMIT, otherwise ABORT. The result is atomic — every
 * participant reaches the same decision.
 *
 * 2PC is also a great teaching tool for its weakness: it is a *blocking*
 * protocol. If the coordinator crashes after participants prepare, they are
 * stuck holding locks — the very problem consensus protocols like Raft were
 * designed to avoid. Crash the coordinator mid-transaction and watch.
 */
import type { Protocol } from "../engine/protocol.js";
import type { Message, NodeId } from "../engine/types.js";

interface Begin extends Message {
  type: "2pc-begin";
  txId: number;
}
interface Prepare extends Message {
  type: "2pc-prepare";
  txId: number;
}
interface Vote extends Message {
  type: "2pc-vote";
  txId: number;
  yes: boolean;
}
interface Decision extends Message {
  type: "2pc-commit" | "2pc-abort";
  txId: number;
}

export type TwoPCMessage = Begin | Prepare | Vote | Decision;

export type TxOutcome = "committed" | "aborted";

export interface CoordinatorState {
  phase: "idle" | "collecting" | "committed" | "aborted";
  txId: number | null;
  votes: Record<NodeId, boolean>;
  outcome: TxOutcome | null;
}

export interface ParticipantState {
  /** Outcome per transaction id. */
  decisions: Record<number, TxOutcome>;
  lastVote: boolean | null;
}

export interface CoordinatorOptions {
  /** Abort if not all votes are in within this window. */
  readonly timeout?: number;
}

/** The transaction coordinator. Participants are taken from `ctx.peers`. */
export function twoPhaseCommitCoordinator(
  options: CoordinatorOptions = {},
): Protocol<CoordinatorState, TwoPCMessage> {
  const timeout = options.timeout ?? 2000;
  return {
    name: "2pc-coordinator",
    init: () => ({ phase: "idle", txId: null, votes: {}, outcome: null }),
    onMessage(ctx, state, _from, message) {
      if (message.type === "2pc-begin") {
        state.phase = "collecting";
        state.txId = message.txId;
        state.votes = {};
        state.outcome = null;
        ctx.log("info", "begins transaction", { txId: message.txId });
        for (const p of ctx.peers) ctx.send(p, { type: "2pc-prepare", txId: message.txId });
        ctx.setTimer(timeout, `timeout:${message.txId}`);
        return state;
      }

      if (
        message.type === "2pc-vote" &&
        state.phase === "collecting" &&
        message.txId === state.txId
      ) {
        state.votes[_from] = message.yes;
        if (!message.yes) {
          decide(ctx, state, "aborted");
        } else if (ctx.peers.every((p) => state.votes[p] === true)) {
          decide(ctx, state, "committed");
        }
      }
      return state;
    },
    onTimer(ctx, state, token) {
      if (token === `timeout:${state.txId}` && state.phase === "collecting") {
        ctx.log("warn", "transaction timed out, aborting", { txId: state.txId });
        decide(ctx, state, "aborted");
      }
      return state;
    },
  };

  function decide(
    ctx: Parameters<Protocol<CoordinatorState, TwoPCMessage>["onMessage"]>[0],
    state: CoordinatorState,
    outcome: TxOutcome,
  ): void {
    state.phase = outcome;
    state.outcome = outcome;
    const type = outcome === "committed" ? "2pc-commit" : "2pc-abort";
    ctx.log("info", `decides ${outcome}`, { txId: state.txId });
    for (const p of ctx.peers) ctx.send(p, { type, txId: state.txId as number });
  }
}

/**
 * A participant. `vote` decides how it responds to PREPARE — a boolean, or a
 * function of the transaction id (to simulate a participant that refuses).
 */
export function twoPhaseCommitParticipant(
  vote: boolean | ((txId: number) => boolean) = true,
): Protocol<ParticipantState, TwoPCMessage> {
  const willVote = (txId: number): boolean => (typeof vote === "function" ? vote(txId) : vote);
  return {
    name: "2pc-participant",
    init: () => ({ decisions: {}, lastVote: null }),
    onMessage(ctx, state, from, message) {
      switch (message.type) {
        case "2pc-prepare": {
          const yes = willVote(message.txId);
          state.lastVote = yes;
          ctx.send(from, { type: "2pc-vote", txId: message.txId, yes });
          return state;
        }
        case "2pc-commit":
          state.decisions[message.txId] = "committed";
          return state;
        case "2pc-abort":
          state.decisions[message.txId] = "aborted";
          return state;
        default:
          return state;
      }
    },
    onTimer: (_c, s) => s,
  };
}
