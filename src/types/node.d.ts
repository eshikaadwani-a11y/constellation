/**
 * Minimal ambient declarations for the handful of Node.js built-ins used by the
 * test suite.
 *
 * Constellation has zero dependencies — including zero dev dependencies — so it
 * cannot pull in `@types/node`. The engine itself is isomorphic and never
 * imports Node modules; only the `*.test.ts` files do, and they use a tiny,
 * stable slice of the standard library declared here.
 */

declare module "node:test" {
  type TestFn = () => void | Promise<void>;
  interface TestApi {
    (name: string, fn: TestFn): Promise<void>;
    (fn: TestFn): Promise<void>;
  }
  export const test: TestApi;
  export const it: TestApi;
  export function describe(name: string, fn: () => void): void;
  export function before(fn: TestFn): void;
  export function after(fn: TestFn): void;
  export function beforeEach(fn: TestFn): void;
  export function afterEach(fn: TestFn): void;
}

declare module "node:assert/strict" {
  interface Assert {
    (value: unknown, message?: string): asserts value;
    ok(value: unknown, message?: string): asserts value;
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    notDeepEqual(actual: unknown, expected: unknown, message?: string): void;
    throws(fn: () => unknown, expected?: unknown, message?: string): void;
    doesNotThrow(fn: () => unknown, message?: string): void;
    match(value: string, regexp: RegExp, message?: string): void;
    doesNotMatch(value: string, regexp: RegExp, message?: string): void;
    rejects(fn: () => Promise<unknown>, expected?: unknown, message?: string): Promise<void>;
    fail(message?: string): never;
  }
  const assert: Assert;
  export default assert;
}
