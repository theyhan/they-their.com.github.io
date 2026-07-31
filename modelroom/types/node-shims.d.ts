// Minimal ambient declarations for the Node builtins this package uses.
//
// @types/node cannot be installed (npm registry returns 403 in this sandbox), so
// rather than disabling type checking we declare only the exact surface used.
// Replace this file with `@types/node` once dependency installation is possible.

declare module "node:crypto" {
  interface Hash {
    update(data: string): Hash;
    digest(encoding: "hex"): string;
  }
  export function createHash(algorithm: string): Hash;
  export function randomUUID(): string;
}

declare module "node:test" {
  type TestFn = () => void | Promise<void>;
  export function test(name: string, fn: TestFn): void;
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: TestFn): void;
}

declare module "node:assert/strict" {
  interface AssertStrict {
    (value: unknown, message?: string): void;
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
    throws(fn: () => unknown, expected?: unknown, message?: string): void;
    rejects(fn: () => Promise<unknown>, expected?: unknown, message?: string): Promise<void>;
    fail(message?: string): never;
  }
  const assert: AssertStrict;
  export default assert;
}

declare function structuredClone<T>(value: T): T;
