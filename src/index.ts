/**
 * Public entry point for the Constellation engine.
 *
 * The engine is isomorphic: it has no dependency on the DOM or on Node-specific
 * APIs, so the exact same code powers the in-browser laboratory and the
 * Node-based test suite.
 */
export { VERSION } from "./version.js";
export { Random } from "./core/prng.js";
export { MinHeap } from "./core/heap.js";
