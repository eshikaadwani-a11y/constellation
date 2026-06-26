/**
 * The laboratory view: the top bar, the control toolbar, the interactive
 * topology canvas, and the node inspector, wired to a single live simulation.
 */
import { useEffect, useState } from "react";
import { VERSION } from "@constellation/engine";
import { scenarioById } from "../scenarios.js";
import { TopologyCanvas } from "./TopologyCanvas.js";
import { Toolbar } from "./Toolbar.js";
import { Inspector } from "./Inspector.js";
import { ObservabilityPanel } from "../observability/ObservabilityPanel.js";
import { useSimulation } from "./useSimulation.js";

const LOGO = (
  <svg viewBox="0 0 32 32" fill="none" width={20} height={20} aria-hidden="true">
    <circle cx={16} cy={6} r={3} fill="#5b8cff" />
    <circle cx={6} cy={22} r={3} fill="#ffb347" />
    <circle cx={26} cy={22} r={3} fill="#b07bff" />
    <path d="M16 6 L6 22 M16 6 L26 22 M6 22 L26 22" stroke="#38405a" strokeWidth={1.5} />
  </svg>
);

export function LabView(): JSX.Element {
  const sim = useSimulation("raft");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const scenario = scenarioById(sim.scenarioId);

  // Colour Raft nodes by role (leader / candidate / follower); other protocols
  // fall back to the default node colour.
  const accentOf = (id: string): string | undefined => {
    const state = sim.stateOf(id) as { role?: string } | undefined;
    switch (state?.role) {
      case "leader":
        return "var(--role-leader)";
      case "candidate":
        return "var(--role-candidate)";
      case "follower":
        return "var(--role-follower)";
      default:
        return undefined;
    }
  };
  const isRaft = sim.scenarioId === "raft";

  // Keyboard shortcuts: space toggles playback, "s" single-steps.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        sim.toggle();
      } else if (e.key === "s") {
        sim.step();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sim]);

  return (
    <div className="lab">
      <header className="topbar">
        <div className="topbar__left">
          <div className="topbar__brand">
            {LOGO}
            <span>Constellation</span>
          </div>
          <span className="topbar__ws" title={scenario.description}>
            {scenario.name}
          </span>
        </div>
        <div className="topbar__right">
          <span className="topbar__ws">engine v{VERSION}</span>
          <span className="topbar__ws" style={{ color: "var(--success)" }}>
            ● live
          </span>
        </div>
      </header>

      <Toolbar sim={sim} />

      <div className="lab__content">
        <div className="lab__canvas">
          <TopologyCanvas
            snapshot={sim.snapshot}
            selectedId={selectedId}
            onSelect={setSelectedId}
            accentOf={accentOf}
          />
          {isRaft && (
            <div className="legend">
              <span>
                <i style={{ background: "var(--role-leader)" }} /> leader
              </span>
              <span>
                <i style={{ background: "var(--role-candidate)" }} /> candidate
              </span>
              <span>
                <i style={{ background: "var(--role-follower)" }} /> follower
              </span>
              <span>
                <i style={{ background: "var(--role-down)" }} /> crashed
              </span>
            </div>
          )}
        </div>
        <Inspector
          snapshot={sim.snapshot}
          selectedId={selectedId}
          sim={sim}
          onClose={() => setSelectedId(null)}
        />
      </div>

      <ObservabilityPanel sim={sim} />
    </div>
  );
}
