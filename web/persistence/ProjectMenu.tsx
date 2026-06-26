/**
 * Project controls: save the current recipe, reload a saved one, and export the
 * recorded run as a portable event log.
 */
import { useState } from "react";
import { serializeEvents } from "@constellation/engine";
import type { SimController } from "../topology/useSimulation.js";
import {
  deleteProject,
  downloadFile,
  listProjects,
  saveProject,
  type SavedProject,
} from "./projectStore.js";

export function ProjectMenu({ sim }: { sim: SimController }): JSX.Element {
  const [projects, setProjects] = useState<SavedProject[]>(() => listProjects());

  const refresh = (): void => setProjects(listProjects());

  const onSave = (): void => {
    const name = window.prompt("Name this project", `${sim.scenarioId} · seed ${sim.seed}`);
    if (!name) return;
    saveProject({ name, scenarioId: sim.scenarioId, nodeCount: sim.nodeCount, seed: sim.seed });
    refresh();
  };

  const onLoad = (id: string): void => {
    const project = projects.find((p) => p.id === id);
    if (project) sim.load(project.scenarioId, project.nodeCount, project.seed);
  };

  const onExport = (): void => {
    downloadFile(`constellation-run-${Date.now()}.json`, serializeEvents(sim.recorder.all()));
  };

  return (
    <div className="toolbar__group">
      <button className="btn" onClick={onSave} title="Save this scenario, size, and seed">
        💾 Save
      </button>
      <select
        className="project-select"
        value=""
        onChange={(e: { target: { value: string } }) => {
          if (e.target.value === "__delete") return;
          onLoad(e.target.value);
        }}
        title="Load a saved project"
      >
        <option value="">Load…</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button className="btn" onClick={onExport} title="Export the recorded run as JSON">
        ⤓ Export run
      </button>
      {projects.length > 0 && (
        <button
          className="btn"
          title="Delete the most recent saved project"
          onClick={() => {
            const latest = projects[0];
            if (latest && window.confirm(`Delete project “${latest.name}”?`)) {
              deleteProject(latest.id);
              refresh();
            }
          }}
        >
          🗑
        </button>
      )}
    </div>
  );
}
