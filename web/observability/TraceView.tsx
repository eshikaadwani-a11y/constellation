/**
 * The trace view: a waterfall of causal message chains reconstructed from the
 * event stream. Each row is a message; indentation shows what it was caused by.
 */
import { useMemo } from "react";
import { buildTraces, type EventRecorder, type TraceSpan } from "@constellation/engine";

interface Props {
  recorder: EventRecorder;
  version: number;
  viewTime: number;
}

function Row({ span, depth }: { span: TraceSpan; depth: number }): JSX.Element {
  const latency =
    span.deliveredAt !== undefined ? `${Math.round(span.deliveredAt - span.sentAt)}ms` : "—";
  return (
    <>
      <div className="trace__row" style={{ paddingLeft: `${depth * 16}px` }}>
        <span className="trace__type">{span.type}</span>
        <span className="trace__path">
          {span.from} → {span.to}
        </span>
        <span
          className="trace__latency"
          style={{ color: span.dropped ? "var(--danger)" : "var(--text-tertiary)" }}
        >
          {span.dropped ? "dropped" : latency}
        </span>
      </div>
      {span.children.map((child) => (
        <Row key={child.id} span={child} depth={depth + 1} />
      ))}
    </>
  );
}

export function TraceView({ recorder, version, viewTime }: Props): JSX.Element {
  const roots = useMemo(() => {
    const events = Number.isFinite(viewTime) ? recorder.until(viewTime) : recorder.all();
    return buildTraces(events).roots.slice(-30).reverse();
  }, [recorder, version, viewTime]);

  if (roots.length === 0) {
    return <div className="trace trace--empty">No traces yet — let the simulation run.</div>;
  }

  return (
    <div className="trace">
      {roots.map((root) => (
        <div className="trace__group" key={root.id}>
          <Row span={root} depth={0} />
        </div>
      ))}
    </div>
  );
}
