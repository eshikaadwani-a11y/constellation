# Raft, as implemented in Constellation

[Raft](https://raft.github.io/) is a consensus algorithm for keeping a replicated log consistent
across a cluster even as nodes fail. Constellation implements it as a single
[`Protocol`](../src/protocols/raft.ts) — a good demonstration that the engine's plugin contract is
expressive enough for real algorithms.

This is a reading guide, not a re-derivation of the paper. For the full treatment see
[_In Search of an Understandable Consensus Algorithm_](https://raft.github.io/raft.pdf) by Ongaro
and Ousterhout.

## The three roles

Every node is always in one of three states:

- **Follower** — passive; resets an election timer whenever it hears from a valid leader.
- **Candidate** — campaigning for votes after its election timer fired.
- **Leader** — the single node that accepts client commands and replicates them.

Time is divided into **terms**, a logical clock that increments on every election. At most one
leader exists per term — the property the tests pin down.

## Leader election

1. A follower that hears nothing for a randomized timeout becomes a candidate, increments its term,
   votes for itself, and sends `request-vote` RPCs to every peer.
2. A node grants its vote if it hasn't already voted this term and the candidate's log is at least
   as up to date as its own (the "up-to-date" rule prevents a node with a stale log from winning).
3. A candidate that collects votes from a **majority** becomes leader and immediately starts sending
   heartbeats.

The timeout is randomized (`ctx.randomInt`) so split votes are rare and self-correcting — and
because that randomness comes from the seeded generator, the resolution of any split is perfectly
reproducible.

## Log replication

The leader appends client commands to its log and ships them to followers with `append-entries`
RPCs. Each RPC carries the index and term of the entry **preceding** the new ones; a follower
accepts them only if that entry matches, which inductively guarantees the **Log Matching Property**:
if two logs agree at an index, they agree on everything before it.

An entry is **committed** once it is stored on a majority — and Raft only commits entries from the
current term directly, which is the subtle rule that preserves safety across leader changes. Once
committed, the leader advances `commitIndex`, and followers learn the new value from the
`leaderCommit` field of the next heartbeat.

## What the tests prove

[`raft.test.ts`](../src/protocols/raft.test.ts) asserts the properties that matter:

- **Election Safety** — across an 8-second run with re-elections, no term ever has two leaders.
- **Log consistency** — after replicating several commands, every node's log is byte-for-byte
  identical to the leader's.
- **Liveness under failure** — crash the leader and a new one, with a strictly higher term, is
  elected within bounded time.
- **Determinism** — the same seed always elects the same leader.

## Try it

Open the lab (the Raft scenario is the default). Nodes are coloured by role — amber for the leader,
purple for a candidate mid-election, blue for followers. Select a node to watch its term, log, and
`commitIndex` update live, then crash the leader and watch the cluster elect a replacement.
