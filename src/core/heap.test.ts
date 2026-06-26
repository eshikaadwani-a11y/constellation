import { test } from "node:test";
import assert from "node:assert/strict";
import { MinHeap } from "./heap.js";
import { Random } from "./prng.js";

const numeric = (a: number, b: number) => a - b;

test("pops elements in ascending order", () => {
  const heap = new MinHeap<number>(numeric);
  const r = new Random(11);
  const input = Array.from({ length: 1000 }, () => r.int(0, 100000));
  for (const v of input) heap.push(v);

  const out: number[] = [];
  while (!heap.isEmpty()) out.push(heap.pop() as number);

  assert.deepEqual(out, input.slice().sort(numeric));
});

test("peek reflects the current minimum", () => {
  const heap = new MinHeap<number>(numeric);
  heap.push(5);
  heap.push(3);
  heap.push(8);
  assert.equal(heap.peek(), 3);
  heap.pop();
  assert.equal(heap.peek(), 5);
});

test("pop on empty heap returns undefined", () => {
  const heap = new MinHeap<number>(numeric);
  assert.equal(heap.pop(), undefined);
  assert.equal(heap.peek(), undefined);
  assert.ok(heap.isEmpty());
});

test("tie-break by secondary key preserves stable ordering", () => {
  // Events scheduled at the same time must dequeue in insertion order.
  const heap = new MinHeap<{ time: number; seq: number }>(
    (a, b) => a.time - b.time || a.seq - b.seq,
  );
  heap.push({ time: 10, seq: 2 });
  heap.push({ time: 10, seq: 1 });
  heap.push({ time: 5, seq: 3 });
  assert.deepEqual(heap.pop(), { time: 5, seq: 3 });
  assert.deepEqual(heap.pop(), { time: 10, seq: 1 });
  assert.deepEqual(heap.pop(), { time: 10, seq: 2 });
});

test("size tracks pushes and pops", () => {
  const heap = new MinHeap<number>(numeric);
  assert.equal(heap.size, 0);
  heap.push(1);
  heap.push(2);
  assert.equal(heap.size, 2);
  heap.pop();
  assert.equal(heap.size, 1);
  heap.clear();
  assert.equal(heap.size, 0);
});
