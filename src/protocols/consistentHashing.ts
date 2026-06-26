/**
 * Consistent hashing — the data structure behind sharded caches, distributed
 * stores, and CDN request routing.
 *
 * Keys and nodes are hashed onto the same circular keyspace; a key is owned by
 * the first node clockwise from it. Each physical node is placed at many points
 * on the ring ("virtual nodes") so load stays balanced. The defining property:
 * adding or removing a node remaps only ~1/N of the keys, instead of nearly all
 * of them as a naive `hash(key) % N` would.
 */
import type { NodeId } from "../engine/types.js";

/** FNV-1a, a fast, well-distributed 32-bit string hash. */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

interface RingPoint {
  readonly hash: number;
  readonly node: NodeId;
}

export interface HashRingOptions {
  /** Virtual nodes per physical node. More points → smoother balance. */
  readonly virtualNodes?: number;
  readonly hash?: (input: string) => number;
}

export class HashRing {
  private readonly virtualNodes: number;
  private readonly hash: (input: string) => number;
  private readonly nodeSet = new Set<NodeId>();
  private points: RingPoint[] = []; // sorted by hash ascending

  constructor(options: HashRingOptions = {}) {
    this.virtualNodes = options.virtualNodes ?? 128;
    this.hash = options.hash ?? fnv1a;
  }

  get size(): number {
    return this.nodeSet.size;
  }

  nodes(): NodeId[] {
    return [...this.nodeSet];
  }

  /** Adds a node and its virtual points to the ring. */
  add(node: NodeId): void {
    if (this.nodeSet.has(node)) return;
    this.nodeSet.add(node);
    for (let i = 0; i < this.virtualNodes; i++) {
      this.points.push({ hash: this.hash(`${node}#${i}`), node });
    }
    this.points.sort((a, b) => a.hash - b.hash);
  }

  /** Removes a node and all its virtual points. */
  remove(node: NodeId): void {
    if (!this.nodeSet.delete(node)) return;
    this.points = this.points.filter((p) => p.node !== node);
  }

  /** Returns the node responsible for `key`, or undefined if the ring is empty. */
  get(key: string): NodeId | undefined {
    if (this.points.length === 0) return undefined;
    const h = this.hash(key);
    // First ring point with hash >= h, wrapping around to the start.
    let lo = 0;
    let hi = this.points.length - 1;
    let idx = 0;
    if (h > (this.points[hi] as RingPoint).hash) {
      idx = 0; // wrap
    } else {
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if ((this.points[mid] as RingPoint).hash >= h) {
          idx = mid;
          hi = mid - 1;
        } else {
          lo = mid + 1;
        }
      }
    }
    return (this.points[idx] as RingPoint).node;
  }

  /**
   * Returns the `count` distinct nodes clockwise from `key` — the natural way to
   * choose replicas for a key in a Dynamo-style system.
   */
  getReplicas(key: string, count: number): NodeId[] {
    if (this.points.length === 0 || count <= 0) return [];
    const h = this.hash(key);
    const result: NodeId[] = [];
    const n = this.points.length;
    // Find the starting index (first point >= h).
    let start = 0;
    while (start < n && (this.points[start] as RingPoint).hash < h) start++;
    for (let step = 0; step < n && result.length < count; step++) {
      const node = (this.points[(start + step) % n] as RingPoint).node;
      if (!result.includes(node)) result.push(node);
    }
    return result;
  }
}
