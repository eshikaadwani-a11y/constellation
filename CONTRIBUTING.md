# Contributing to Constellation

Thanks for your interest. Constellation aims to be a reference-quality codebase, so contributions
are held to a high bar — not in volume, but in clarity and correctness.

## Principles

- **The engine is the product.** Most engineering effort belongs in `src/`. The UI exists to
  visualize the engine.
- **Determinism is non-negotiable.** Engine code must never read the wall clock, use unseeded
  randomness, or depend on iteration order that isn't explicitly defined. If a change can break
  replay, it needs a test that proves it doesn't.
- **A framework, not a demo.** Prefer extending the plugin surface over special-casing. New
  protocols should not require engine changes.
- **No unnecessary dependencies.** The engine has zero. Add a dependency to the UI only when it
  provides clear, significant value.

## Workflow

1. `npm run build` — both engine and UI must compile.
2. `npm test` — the engine test suite must pass.
3. `npm run lint` — Prettier formatting and strict type-checking must pass.

All three are required before a change is considered done.

## Code style

- TypeScript in `strict` mode with the additional safety flags in `tsconfig.json`
  (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and friends).
- Formatting is handled by Prettier; run `npm run format`.
- Write comments that explain _why_, not _what_. The interesting part of distributed systems code
  is the reasoning.

## Tests

The engine uses Node's built-in test runner. Tests live next to the code they cover as
`*.test.ts`. Favor tests that pin down determinism (same seed → same result) and protocol safety
properties (e.g. "at most one leader per term").
