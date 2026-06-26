import { test } from "node:test";
import assert from "node:assert/strict";
import { Random } from "./prng.js";

test("same seed produces identical streams", () => {
  const a = new Random(42);
  const b = new Random(42);
  const seqA = Array.from({ length: 1000 }, () => a.next());
  const seqB = Array.from({ length: 1000 }, () => b.next());
  assert.deepEqual(seqA, seqB);
});

test("different seeds diverge quickly", () => {
  const a = new Random(1);
  const b = new Random(2);
  let differences = 0;
  for (let i = 0; i < 100; i++) {
    if (a.next() !== b.next()) differences++;
  }
  assert.ok(differences > 95, `expected near-total divergence, got ${differences}/100`);
});

test("next() stays within [0, 1)", () => {
  const r = new Random(7);
  for (let i = 0; i < 10000; i++) {
    const v = r.next();
    assert.ok(v >= 0 && v < 1, `value out of range: ${v}`);
  }
});

test("int() respects inclusive bounds", () => {
  const r = new Random(99);
  const seen = new Set<number>();
  for (let i = 0; i < 5000; i++) seen.add(r.int(3, 7));
  assert.deepEqual(
    [...seen].sort((x, y) => x - y),
    [3, 4, 5, 6, 7],
  );
});

test("snapshot and restore reproduce the stream", () => {
  const r = new Random(123);
  for (let i = 0; i < 50; i++) r.next();
  const snap = r.snapshot();
  const expected = Array.from({ length: 20 }, () => r.next());
  r.restore(snap);
  const actual = Array.from({ length: 20 }, () => r.next());
  assert.deepEqual(actual, expected);
});

test("bernoulli converges to the configured probability", () => {
  const r = new Random(2024);
  let hits = 0;
  const trials = 50000;
  for (let i = 0; i < trials; i++) if (r.bernoulli(0.3)) hits++;
  assert.ok(Math.abs(hits / trials - 0.3) < 0.01, `ratio drifted: ${hits / trials}`);
});

test("exponential mean is approximately correct", () => {
  const r = new Random(555);
  let sum = 0;
  const trials = 100000;
  for (let i = 0; i < trials; i++) sum += r.exponential(10);
  assert.ok(Math.abs(sum / trials - 10) < 0.2, `mean drifted: ${sum / trials}`);
});

test("shuffle is a permutation and does not mutate input", () => {
  const r = new Random(3);
  const input = [1, 2, 3, 4, 5];
  const out = r.shuffle(input);
  assert.deepEqual(input, [1, 2, 3, 4, 5]);
  assert.deepEqual(
    out.slice().sort((a, b) => a - b),
    [1, 2, 3, 4, 5],
  );
});

test("fork produces an independent but deterministic stream", () => {
  const parent1 = new Random(77);
  const fork1 = parent1.fork();
  const parent2 = new Random(77);
  const fork2 = parent2.fork();
  assert.equal(fork1.next(), fork2.next());
});
