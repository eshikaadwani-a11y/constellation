/**
 * The control bar: scenario selection, cluster size, seed, and transport-style
 * playback controls, alongside live run statistics.
 */
import { SCENARIOS, scenarioById } from "../scenarios.js";
import { ProjectMenu } from "../persistence/ProjectMenu.js";
import type { SimController } from "./useSimulation.js";

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];

interface Stat {
  label: string;
  value: string;
  tone?: string;
}

export function Toolbar({ sim }: { sim: SimController }): JSX.Element {
  const scenario = scenarioById(sim.scenarioId);

  const stats: Stat[] = [
    { label: "virtual time", value: `${Math.round(sim.time).toLocaleString()} ms` },
    { label: "events", value: sim.stats.events.toLocaleString() },
    { label: "in flight", value: String(sim.stats.inFlight), tone: "var(--primary)" },
    { label: "delivered", value: sim.stats.delivered.toLocaleString(), tone: "var(--success)" },
    { label: "dropped", value: sim.stats.dropped.toLocaleString(), tone: "var(--danger)" },
  ];

  return (
    <div className="toolbar">
      <div className="toolbar__group">
        <button
          className="btn btn--primary"
          onClick={sim.toggle}
          title={sim.playing ? "Pause (space)" : "Play (space)"}
        >
          {sim.playing ? "❚❚ Pause" : "▶ Play"}
        </button>
        <button className="btn" onClick={sim.step} title="Step one event">
          ⏭ Step
        </button>
        <button className="btn" onClick={sim.reset} title="Restart this scenario">
          ↺ Reset
        </button>
        <label className="toolbar__field">
          speed
          <select
            value={sim.speed}
            onChange={(e: { target: { value: string } }) => sim.setSpeed(Number(e.target.value))}
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="toolbar__group">
        <label className="toolbar__field">
          scenario
          <select
            value={sim.scenarioId}
            onChange={(e: { target: { value: string } }) =>
              sim.load(e.target.value, scenarioById(e.target.value).defaultNodes, sim.seed)
            }
          >
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="toolbar__field">
          nodes
          <input
            type="range"
            min={scenario.minNodes}
            max={scenario.maxNodes}
            value={sim.nodeCount}
            onChange={(e: { target: { value: string } }) =>
              sim.load(sim.scenarioId, Number(e.target.value), sim.seed)
            }
          />
          <span className="toolbar__count">{sim.nodeCount}</span>
        </label>
        <label className="toolbar__field">
          seed
          <input
            className="toolbar__seed"
            type="number"
            value={sim.seed}
            onChange={(e: { target: { value: string } }) =>
              sim.load(sim.scenarioId, sim.nodeCount, Number(e.target.value) || 0)
            }
          />
        </label>
      </div>

      <div className="toolbar__group">
        <label className="toolbar__field">
          loss
          <input
            type="range"
            min={0}
            max={50}
            value={Math.round(sim.loss * 100)}
            onChange={(e: { target: { value: string } }) =>
              sim.setLoss(Number(e.target.value) / 100)
            }
          />
          <span className="toolbar__count">{Math.round(sim.loss * 100)}%</span>
        </label>
        <button
          className={`btn ${sim.monkey ? "btn--danger" : ""}`}
          onClick={sim.toggleMonkey}
          title="Repeatedly crash random nodes"
        >
          🐵 Monkey
        </button>
        {sim.isolated.length > 0 && (
          <button className="btn" onClick={sim.reconnectAll}>
            ⇄ Reconnect ({sim.isolated.length})
          </button>
        )}
      </div>

      <ProjectMenu sim={sim} />

      <div className="toolbar__stats">
        {stats.map((s) => (
          <div className="toolbar__stat" key={s.label}>
            <span className="toolbar__statvalue" style={s.tone ? { color: s.tone } : undefined}>
              {s.value}
            </span>
            <span className="toolbar__statlabel">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
