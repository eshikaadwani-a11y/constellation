/**
 * Deterministic graph layout.
 *
 * Layout is a pure function of the node set, so the topology looks identical on
 * every run and every machine — no physics jitter, no random seeding from the
 * wall clock. Two layouts are provided: a circular arrangement (ideal for the
 * symmetric clusters that consensus protocols form) and a force-directed
 * arrangement seeded deterministically for larger, irregular graphs.
 */
import { Random } from "../core/prng.js";
import type { NodeId } from "../engine/types.js";

export interface Point {
  x: number;
  y: number;
}

export type Positions = Map<NodeId, Point>;

export interface CircularOptions {
  radius?: number;
  center?: Point;
  /** Rotation offset in radians; lets a leader sit at the top, say. */
  rotation?: number;
}

/** Arranges nodes evenly around a circle, in their given order. */
export function circularLayout(ids: readonly NodeId[], options: CircularOptions = {}): Positions {
  const { radius = 220, center = { x: 0, y: 0 }, rotation = -Math.PI / 2 } = options;
  const positions: Positions = new Map();
  const n = ids.length;
  if (n === 0) return positions;
  if (n === 1) {
    positions.set(ids[0] as NodeId, { x: center.x, y: center.y });
    return positions;
  }
  for (let i = 0; i < n; i++) {
    const angle = rotation + (2 * Math.PI * i) / n;
    positions.set(ids[i] as NodeId, {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    });
  }
  return positions;
}

export interface ForceOptions {
  /** Seed for the deterministic initial placement. */
  seed?: number;
  iterations?: number;
  /** Target edge length. */
  linkDistance?: number;
  /** Repulsion strength between all node pairs. */
  charge?: number;
  center?: Point;
  area?: number;
}

/**
 * A compact deterministic force-directed layout (Fruchterman–Reingold style).
 * Initial positions are drawn from a seeded generator, then relaxed for a fixed
 * number of iterations, so the result is reproducible.
 */
export function forceLayout(
  ids: readonly NodeId[],
  links: ReadonlyArray<readonly [NodeId, NodeId]>,
  options: ForceOptions = {},
): Positions {
  const {
    seed = 1,
    iterations = 300,
    linkDistance = 120,
    charge = 6000,
    center = { x: 0, y: 0 },
    area = 600,
  } = options;

  const rng = new Random(seed);
  const positions: Positions = new Map();
  for (const id of ids) {
    positions.set(id, { x: rng.float(-area / 2, area / 2), y: rng.float(-area / 2, area / 2) });
  }
  if (ids.length < 2) {
    if (ids.length === 1) positions.set(ids[0] as NodeId, { ...center });
    return positions;
  }

  const k = linkDistance;
  let temperature = area / 10;
  const cooling = temperature / (iterations + 1);

  for (let iter = 0; iter < iterations; iter++) {
    const disp = new Map<NodeId, Point>();
    for (const id of ids) disp.set(id, { x: 0, y: 0 });

    // Repulsive forces between every pair.
    for (let i = 0; i < ids.length; i++) {
      const a = ids[i] as NodeId;
      const pa = positions.get(a) as Point;
      for (let j = i + 1; j < ids.length; j++) {
        const b = ids[j] as NodeId;
        const pb = positions.get(b) as Point;
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.01) {
          dx = rng.float(-1, 1);
          dy = rng.float(-1, 1);
          dist = Math.hypot(dx, dy) || 0.01;
        }
        const force = charge / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        const da = disp.get(a) as Point;
        const db = disp.get(b) as Point;
        da.x += fx;
        da.y += fy;
        db.x -= fx;
        db.y -= fy;
      }
    }

    // Attractive forces along links.
    for (const [s, t] of links) {
      const ps = positions.get(s);
      const pt = positions.get(t);
      if (!ps || !pt) continue;
      const dx = ps.x - pt.x;
      const dy = ps.y - pt.y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const force = (dist * dist) / k;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      const ds = disp.get(s) as Point;
      const dt = disp.get(t) as Point;
      ds.x -= fx;
      ds.y -= fy;
      dt.x += fx;
      dt.y += fy;
    }

    // Apply displacement, capped by the current temperature.
    for (const id of ids) {
      const p = positions.get(id) as Point;
      const d = disp.get(id) as Point;
      const len = Math.hypot(d.x, d.y) || 0.01;
      p.x += (d.x / len) * Math.min(len, temperature);
      p.y += (d.y / len) * Math.min(len, temperature);
    }
    temperature = Math.max(0.1, temperature - cooling);
  }

  // Recenter around the requested center.
  let cx = 0;
  let cy = 0;
  for (const p of positions.values()) {
    cx += p.x;
    cy += p.y;
  }
  cx = cx / positions.size - center.x;
  cy = cy / positions.size - center.y;
  for (const p of positions.values()) {
    p.x -= cx;
    p.y -= cy;
  }
  return positions;
}
