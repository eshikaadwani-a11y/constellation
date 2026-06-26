/**
 * The laboratory shell.
 *
 * This milestone establishes the persistent chrome — top bar, status, and the
 * stage where the topology canvas and telemetry views are mounted in later
 * milestones. It intentionally stays thin: the engine is the product, and the
 * UI grows around it.
 */
import { useState } from "react";
import { VERSION } from "@constellation/engine";
import { runDemo } from "./engineDemo.js";

const LOGO = (
  <svg viewBox="0 0 32 32" fill="none" width={20} height={20} aria-hidden="true">
    <circle cx={16} cy={6} r={3} fill="#5b8cff" />
    <circle cx={6} cy={22} r={3} fill="#ffb347" />
    <circle cx={26} cy={22} r={3} fill="#b07bff" />
    <path d="M16 6 L6 22 M16 6 L26 22 M6 22 L26 22" stroke="#38405a" strokeWidth={1.5} />
  </svg>
);

export function App(): JSX.Element {
  const [engineReady] = useState(true);
  const [demo] = useState(() => runDemo());

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar__left">
          <div className="topbar__brand">
            {LOGO}
            <span>Constellation</span>
          </div>
          <span className="topbar__ws">Untitled scenario</span>
        </div>
        <div className="topbar__right">
          <span className="topbar__ws" title="Engine version">
            engine v{VERSION}
          </span>
          <span
            className="topbar__ws"
            style={{ color: engineReady ? "var(--success)" : "var(--text-tertiary)" }}
          >
            ● {engineReady ? "engine online" : "loading"}
          </span>
        </div>
      </header>

      <main className="workspace">
        <div className="workspace__inner">
          <h2>The simulation engine is live</h2>
          <p>
            A deterministic ping-pong scenario just ran entirely in your browser — {demo.rounds}{" "}
            round-trips across {demo.events} events of virtual time, finishing at{" "}
            {demo.virtualTime.toLocaleString()}ms. Re-run it a thousand times and you get the exact
            same history.
          </p>
          <p>
            The interactive topology canvas, protocol controls, and time-travel telemetry come
            online in the next milestones.
          </p>
        </div>
      </main>
    </div>
  );
}
