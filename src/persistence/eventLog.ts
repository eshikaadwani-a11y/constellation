/**
 * Event-log export/import.
 *
 * Where a {@link ScenarioSpec} is the reproducible *recipe*, the recorded event
 * stream is the *output* — and being able to export it as JSON lets a run be
 * shared, diffed, or analyzed offline (the events fully describe everything that
 * happened). This is the read side of the engine's event-sourced design.
 */
import type { SimEvent } from "../engine/events.js";
import { VERSION } from "../version.js";

export interface EventLogFile {
  readonly format: "constellation-eventlog";
  readonly version: string;
  readonly count: number;
  readonly events: SimEvent[];
}

/** Serializes a recorded event stream to a portable JSON document. */
export function serializeEvents(events: readonly SimEvent[]): string {
  const file: EventLogFile = {
    format: "constellation-eventlog",
    version: VERSION,
    count: events.length,
    events: [...events],
  };
  return JSON.stringify(file);
}

/** Parses an exported event log, validating its envelope. */
export function parseEvents(json: string): SimEvent[] {
  const file = JSON.parse(json) as EventLogFile;
  if (file.format !== "constellation-eventlog") throw new Error("not a Constellation event log");
  if (!Array.isArray(file.events)) throw new Error("event log is missing its events array");
  return file.events;
}
