/**
 * Public entry point for the Constellation engine.
 *
 * The engine is isomorphic: it has no dependency on the DOM or on Node-specific
 * APIs, so the exact same code powers the in-browser laboratory and the
 * Node-based test suite.
 */
export { VERSION } from "./version.js";

// Core primitives
export { Random } from "./core/prng.js";
export { MinHeap } from "./core/heap.js";

// Simulation engine
export * from "./engine/index.js";

// Networking layer
export * from "./network/index.js";

// Distributed protocol library
export * from "./protocols/index.js";

// Observability: recording, metrics, logs, tracing
export * from "./observability/index.js";

// Chaos engineering
export * from "./chaos/index.js";

// Systems tutor (deterministic behaviour explanations)
export * from "./tutor/index.js";

// Cloud infrastructure (scheduler + orchestration control plane)
export * from "./cloud/index.js";

// Visualization support (deterministic layout + topology model)
export * from "./topology/index.js";
