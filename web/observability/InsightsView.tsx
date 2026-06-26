/**
 * The systems tutor panel: a live, plain-language explanation of why the
 * cluster behaved as it did, derived deterministically from the event stream.
 * Click an insight to jump the timeline to that moment.
 */
import { useMemo } from "react";
import { analyze, type EventRecorder, type InsightSeverity } from "@constellation/engine";

interface Props {
  recorder: EventRecorder;
  version: number;
  viewTime: number;
  onJump: (time: number) => void;
}

const SEVERITY_COLOR: Record<InsightSeverity, string> = {
  good: "var(--success)",
  info: "var(--primary)",
  warning: "var(--warning)",
  critical: "var(--danger)",
};

export function InsightsView({ recorder, version, viewTime, onJump }: Props): JSX.Element {
  const insights = useMemo(() => {
    const events = Number.isFinite(viewTime) ? recorder.until(viewTime) : recorder.all();
    return analyze(events).slice(-40).reverse();
  }, [recorder, version, viewTime]);

  if (insights.length === 0) {
    return (
      <div className="insights insights--empty">
        The tutor is watching. As the cluster elects leaders, commits entries, and weathers faults,
        it will explain what happened and why.
      </div>
    );
  }

  return (
    <div className="insights">
      {insights.map((i) => (
        <button className="insight" key={i.id} onClick={() => onJump(i.time)}>
          <span className="insight__dot" style={{ background: SEVERITY_COLOR[i.severity] }} />
          <div className="insight__body">
            <div className="insight__head">
              <span className="insight__title">{i.title}</span>
              <span className="insight__time">{Math.round(i.time).toLocaleString()}ms</span>
            </div>
            <p className="insight__detail">{i.detail}</p>
          </div>
        </button>
      ))}
    </div>
  );
}
