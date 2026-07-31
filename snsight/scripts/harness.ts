/**
 * Minimal check harness, dependency-free so it runs before `npm install` is possible.
 *
 * Async checks are collected and awaited by `report`. Without that, a rejected assertion inside an
 * async check becomes an unhandled rejection while the check still counts as passed - a harness that
 * reports success regardless of the outcome is worse than none.
 *
 * These move to Vitest once the toolchain is installed; the assertions do not change.
 */

let passed = 0;
const failures: string[] = [];
const pending: Promise<void>[] = [];

function describeError(name: string, error: unknown): string {
  return `${name}: ${error instanceof Error ? error.message : String(error)}`;
}

export function check(name: string, fn: () => void | Promise<void>): void {
  try {
    const result = fn();
    if (result instanceof Promise) {
      pending.push(
        result.then(
          () => {
            passed += 1;
          },
          (error: unknown) => {
            failures.push(describeError(name, error));
          },
        ),
      );
      return;
    }
    passed += 1;
  } catch (error) {
    failures.push(describeError(name, error));
  }
}

export function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** Awaits outstanding async checks, prints the summary, and sets a non-zero exit code on failure. */
export async function report(title: string): Promise<void> {
  await Promise.all(pending);

  console.log(`\n${passed} checks passed`);
  if (failures.length > 0) {
    console.error(`${failures.length} failed:\n`);
    for (const failure of failures) console.error(`  x ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${title}\n`);
}
