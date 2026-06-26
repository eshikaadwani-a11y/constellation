/**
 * A binary min-heap used as the priority queue at the centre of the simulation
 * scheduler. Events are ordered by `(time, sequence)` so that ties break in
 * insertion order, which keeps the simulation deterministic.
 *
 * The implementation is intentionally allocation-light: it operates on a flat
 * array and sifts in place.
 */
export class MinHeap<T> {
  private readonly items: T[] = [];

  /**
   * @param compare Returns a negative number when `a` should be dequeued before
   * `b`, mirroring `Array.prototype.sort`.
   */
  constructor(private readonly compare: (a: T, b: T) => number) {}

  get size(): number {
    return this.items.length;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  /** Returns the minimum element without removing it. */
  peek(): T | undefined {
    return this.items[0];
  }

  push(value: T): void {
    const items = this.items;
    items.push(value);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.compare(items[i] as T, items[parent] as T) >= 0) break;
      [items[i], items[parent]] = [items[parent] as T, items[i] as T];
      i = parent;
    }
  }

  /** Removes and returns the minimum element, or undefined when empty. */
  pop(): T | undefined {
    const items = this.items;
    const n = items.length;
    if (n === 0) return undefined;
    const top = items[0];
    const last = items.pop() as T;
    if (n > 1) {
      items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  clear(): void {
    this.items.length = 0;
  }

  private siftDown(start: number): void {
    const items = this.items;
    const n = items.length;
    let i = start;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let smallest = i;
      if (left < n && this.compare(items[left] as T, items[smallest] as T) < 0) smallest = left;
      if (right < n && this.compare(items[right] as T, items[smallest] as T) < 0) smallest = right;
      if (smallest === i) break;
      [items[i], items[smallest]] = [items[smallest] as T, items[i] as T];
      i = smallest;
    }
  }
}
