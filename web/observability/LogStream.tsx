/**
 * The live structured-log view, backed by the unified journal (logs + drops +
 * crashes). Filterable by severity; auto-scrolls while live.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { buildJournal, type EventRecorder, type LogLevel } from "@constellation/engine";

interface Props {
  recorder: EventRecorder;
  version: number;
  viewTime: number;
  live: boolean;
}

const LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];
const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: "var(--text-tertiary)",
  info: "var(--primary)",
  warn: "var(--warning)",
  error: "var(--danger)",
};

export function LogStream({ recorder, version, viewTime, live }: Props): JSX.Element {
  const [minLevel, setMinLevel] = useState<LogLevel>("info");
  const bottomRef = useRef<HTMLDivElement>(null);

  const entries = useMemo(() => {
    const events = Number.isFinite(viewTime) ? recorder.until(viewTime) : recorder.all();
    return buildJournal(events, { minLevel }).slice(-400);
  }, [recorder, version, viewTime, minLevel]);

  useEffect(() => {
    if (live) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [entries, live]);

  return (
    <div className="logs">
      <div className="logs__toolbar">
        <label className="toolbar__field">
          level
          <select
            value={minLevel}
            onChange={(e: { target: { value: string } }) => setMinLevel(e.target.value as LogLevel)}
          >
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}+
              </option>
            ))}
          </select>
        </label>
        <span className="logs__count">{entries.length} entries</span>
      </div>
      <div className="logs__list">
        {entries.map((e) => (
          <div className="logline" key={e.seq}>
            <span className="logline__time">{Math.round(e.time)}ms</span>
            <span className="logline__level" style={{ color: LEVEL_COLOR[e.level] }}>
              {e.level}
            </span>
            <span className="logline__node">{e.nodeId ?? "—"}</span>
            <span className="logline__msg">
              {e.message}
              {Object.keys(e.fields).length > 0 && (
                <span className="logline__fields"> {JSON.stringify(e.fields)}</span>
              )}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
