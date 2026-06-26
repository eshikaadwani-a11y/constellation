/**
 * Local project storage.
 *
 * A "project" in the lab is just a reproducible recipe — the scenario, cluster
 * size, and seed — so saving one is tiny and loading it reproduces the run
 * exactly. Projects are versioned by save time, giving a simple history.
 */
const KEY = "constellation.projects.v1";

export interface SavedProject {
  readonly id: string;
  readonly name: string;
  readonly scenarioId: string;
  readonly nodeCount: number;
  readonly seed: number;
  readonly savedAt: number;
}

function readAll(): SavedProject[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedProject[]) : [];
  } catch {
    return [];
  }
}

function writeAll(projects: SavedProject[]): void {
  localStorage.setItem(KEY, JSON.stringify(projects));
}

/** Most-recently-saved first. */
export function listProjects(): SavedProject[] {
  return readAll().sort((a, b) => b.savedAt - a.savedAt);
}

export function saveProject(project: Omit<SavedProject, "id" | "savedAt">): SavedProject {
  const saved: SavedProject = {
    ...project,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: Date.now(),
  };
  writeAll([saved, ...readAll()]);
  return saved;
}

export function deleteProject(id: string): void {
  writeAll(readAll().filter((p) => p.id !== id));
}

/** Triggers a browser download of a text file. */
export function downloadFile(filename: string, contents: string, type = "application/json"): void {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
