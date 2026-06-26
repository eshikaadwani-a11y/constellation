/**
 * The node inspector: shows a selected node's live state and lets you crash or
 * restart it to see how the protocol reacts.
 */
import type { TopologySnapshot } from "@constellation/engine";
import type { SimController } from "./useSimulation.js";

interface Props {
  snapshot: TopologySnapshot;
  selectedId: string | null;
  sim: SimController;
  onClose: () => void;
}

export function Inspector({ snapshot, selectedId, sim, onClose }: Props): JSX.Element {
  const node = selectedId ? snapshot.nodes.find((n) => n.id === selectedId) : undefined;

  if (!node) {
    return (
      <aside className="inspector inspector--empty">
        <p>Select a node to inspect its state, or crash it to test fault tolerance.</p>
      </aside>
    );
  }

  const state = sim.stateOf(node.id);
  const down = node.status === "down";

  return (
    <aside className="inspector">
      <header className="inspector__head">
        <div>
          <div className="inspector__id">{node.id}</div>
          <div className="inspector__proto">{node.protocol}</div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close inspector">
          ✕
        </button>
      </header>

      <div className="inspector__row">
        <span>Status</span>
        <span style={{ color: down ? "var(--danger)" : "var(--success)" }}>
          ● {down ? "crashed" : "up"}
        </span>
      </div>
      <div className="inspector__row">
        <span>Sent</span>
        <span>{node.sent.toLocaleString()}</span>
      </div>
      <div className="inspector__row">
        <span>Received</span>
        <span>{node.received.toLocaleString()}</span>
      </div>

      <div className="inspector__statelabel">Protocol state</div>
      <pre className="inspector__state">{JSON.stringify(state, null, 2)}</pre>

      {down ? (
        <button className="btn btn--full" onClick={() => sim.restart(node.id)}>
          ↻ Restart node
        </button>
      ) : (
        <button className="btn btn--full btn--danger" onClick={() => sim.crash(node.id)}>
          ⚠ Crash node
        </button>
      )}
    </aside>
  );
}
