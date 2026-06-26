# Getting started

## Prerequisites

- **Node.js 22 or newer** (the project uses the built-in test runner and modern ESM).

That's it. The engine has no dependencies, and the UI loads its libraries at runtime from a CDN via
an import map, so there is no `npm install` step.

## Commands

| Command             | What it does                                                       |
| ------------------- | ------------------------------------------------------------------ |
| `npm run build`     | Compile the engine (`tsc`) and the web UI (`tsc`) into `dist/`.    |
| `npm test`          | Build the engine and run the test suite with `node --test`.        |
| `npm run lint`      | Check formatting with Prettier and strictly type-check everything. |
| `npm run format`    | Auto-format the codebase with Prettier.                            |
| `npm run typecheck` | Type-check the engine and the UI without emitting.                 |
| `npm run dev`       | Build, then serve the lab at `http://127.0.0.1:4173`.              |
| `npm run clean`     | Remove build artifacts.                                            |

## Running the lab

```bash
npm run dev
```

Then open <http://127.0.0.1:4173>. The landing page is at `/` and the laboratory is at `/app.html`.

> The lab's UI libraries (React, React Flow, ECharts, Monaco) are fetched from a CDN at runtime, so
> the lab needs internet access the first time you open it. The engine and tests run fully offline.

## Project structure

See [`architecture.md`](architecture.md) for the full design. In short:

- `src/` is the **engine** — pure, isomorphic TypeScript.
- `web/` is the **UI** — React, compiled by `tsc` to native ES modules.
- `public/` holds static assets and HTML entry points.

## Using the engine directly

The engine is a standalone library. You can drive it from a Node script:

```ts
import { Random } from "@constellation/engine";

const rng = new Random(1234);
const latencies = Array.from({ length: 5 }, () => Math.round(rng.exponential(20)));
console.log(latencies); // deterministic for seed 1234
```

As later milestones land, this guide will grow to cover building a cluster, injecting faults, and
replaying a run.
