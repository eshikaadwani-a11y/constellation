/**
 * A tiny, real use of the engine from the browser bundle.
 *
 * Until the interactive topology canvas lands (milestone 3), this proves the
 * engine runs client-side and is fully deterministic: the lab shell renders the
 * summary returned here, computed by actually stepping the simulation.
 */
import { Simulation, type Message, type Protocol } from "@constellation/engine";

interface Ping extends Message {
  type: "ping";
  n: number;
}
interface Pong extends Message {
  type: "pong";
  n: number;
}
type Msg = Ping | Pong;

function pingPong(target: string | null, limit: number): Protocol<{ rounds: number }, Msg> {
  return {
    name: "ping-pong",
    init(ctx) {
      if (target) ctx.send(target, { type: "ping", n: 0 });
      return { rounds: 0 };
    },
    onMessage(ctx, state, from, message) {
      if (message.type === "ping") {
        ctx.send(from, { type: "pong", n: message.n });
        return state;
      }
      if (message.n < limit) ctx.send(from, { type: "ping", n: message.n + 1 });
      return { rounds: state.rounds + 1 };
    },
    onTimer: (_ctx, state) => state,
  };
}

export interface DemoSummary {
  events: number;
  virtualTime: number;
  rounds: number;
}

/** Runs a fixed scenario and returns a summary. Identical on every call. */
export function runDemo(seed = 42): DemoSummary {
  const sim = new Simulation({ seed });
  sim.addNode("a", pingPong("b", 8));
  sim.addNode("b", pingPong(null, 8));
  sim.run({ until: 10_000 });
  return {
    events: sim.eventCount,
    virtualTime: sim.now,
    rounds: sim.stateOf<{ rounds: number }>("a")?.rounds ?? 0,
  };
}
