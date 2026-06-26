import { test } from "node:test";
import assert from "node:assert/strict";
import { circularLayout, forceLayout } from "./layout.js";

const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

test("circular layout places every node on the circle", () => {
  const ids = ["a", "b", "c", "d", "e"];
  const positions = circularLayout(ids, { radius: 100, center: { x: 0, y: 0 } });
  assert.equal(positions.size, 5);
  for (const id of ids) {
    const p = positions.get(id)!;
    assert.ok(Math.abs(Math.hypot(p.x, p.y) - 100) < 1e-9, `${id} not on radius`);
  }
});

test("circular layout spaces nodes evenly", () => {
  const positions = circularLayout(["a", "b", "c", "d"], { radius: 100 });
  // Four nodes form a square; adjacent distances are equal.
  const a = positions.get("a")!;
  const b = positions.get("b")!;
  const c = positions.get("c")!;
  assert.ok(Math.abs(dist(a, b) - dist(b, c)) < 1e-9);
});

test("circular layout handles 0 and 1 nodes", () => {
  assert.equal(circularLayout([]).size, 0);
  const one = circularLayout(["solo"], { center: { x: 5, y: 7 } });
  assert.deepEqual(one.get("solo"), { x: 5, y: 7 });
});

test("force layout is deterministic for a fixed seed", () => {
  const ids = ["a", "b", "c", "d", "e", "f"];
  const links: Array<[string, string]> = [
    ["a", "b"],
    ["b", "c"],
    ["c", "d"],
    ["d", "e"],
    ["e", "f"],
    ["f", "a"],
  ];
  const first = forceLayout(ids, links, { seed: 99, iterations: 120 });
  const second = forceLayout(ids, links, { seed: 99, iterations: 120 });
  for (const id of ids) {
    assert.deepEqual(first.get(id), second.get(id));
  }
});

test("force layout pushes unconnected nodes apart", () => {
  const ids = ["a", "b", "c"];
  const positions = forceLayout(ids, [], { seed: 1, iterations: 200, charge: 8000 });
  const a = positions.get("a")!;
  const b = positions.get("b")!;
  const c = positions.get("c")!;
  // Repulsion should separate all pairs by a meaningful distance.
  assert.ok(dist(a, b) > 20);
  assert.ok(dist(b, c) > 20);
  assert.ok(dist(a, c) > 20);
});
