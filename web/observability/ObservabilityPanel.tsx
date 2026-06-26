/**
 * The bottom observability dock: a timeline scrubber over tabs for logs,
 * metrics, and traces — all driven by the same recorded history.
 */
import { useState } from "react";
import type { SimController } from "../topology/useSimulation.js";
import { Timeline } from "./Timeline.js";
import { LogStream } from "./LogStream.js";
import { MetricsChart } from "./MetricsChart.js";
import { TraceView } from "./TraceView.js";
import { InsightsView } from "./InsightsView.js";

type Tab = "tutor" | "logs" | "metrics" | "traces";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "tutor", label: "Tutor" },
  { id: "logs", label: "Logs" },
  { id: "metrics", label: "Metrics" },
  { id: "traces", label: "Traces" },
];

export function ObservabilityPanel({ sim }: { sim: SimController }): JSX.Element {
  const [tab, setTab] = useState<Tab>("tutor");
  const viewTime = sim.live ? Number.POSITIVE_INFINITY : (sim.reviewTime ?? 0);

  return (
    <section className="obs">
      <Timeline sim={sim} />
      <div className="obs__tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`obs__tab ${tab === t.id ? "is-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        {!sim.live && <span className="obs__reviewing">⏸ reviewing history</span>}
      </div>
      <div className="obs__body">
        {tab === "tutor" && (
          <InsightsView
            recorder={sim.recorder}
            version={sim.version}
            viewTime={viewTime}
            onJump={sim.scrubTo}
          />
        )}
        {tab === "logs" && (
          <LogStream
            recorder={sim.recorder}
            version={sim.version}
            viewTime={viewTime}
            live={sim.live}
          />
        )}
        {tab === "metrics" && (
          <MetricsChart recorder={sim.recorder} version={sim.version} viewTime={viewTime} />
        )}
        {tab === "traces" && (
          <TraceView recorder={sim.recorder} version={sim.version} viewTime={viewTime} />
        )}
      </div>
    </section>
  );
}
