# ModelRoom Orchestrator Core

Implements the risk-bearing half of [spec v1.1](../docs/modelroom/spec-v1.1.md): the
cost ledger, idempotency lifecycle, task state guards, artifact leases, assignment
scoring, review aggregation, and context packaging.

**Zero runtime dependencies, by necessity and by preference.** The npm registry is
unreachable from the build sandbox (403), so Next.js / NestJS / Prisma / BullMQ could
not be installed. That turned out to be a reasonable constraint: none of the logic
below needs a framework, and all of it needs tests.

```bash
npm run typecheck   # tsc 7.0.2, strict + exactOptionalPropertyTypes + noUncheckedIndexedAccess
npm run test        # node:test, 68 tests
npm run verify      # both
```

Requires Node >= 22.18 for TypeScript type stripping. No build step, no transpiler.

## What is verified

68 passing tests against an in-memory store whose transactions really do roll back, and
a scripted adapter that reproduces failures a live provider will not produce on demand.

| Area | Guarantees under test |
|---|---|
| D1 ledger | reservation makes money unavailable to concurrent runs; output cap derived from remaining budget; refusal below the viable minimum; idempotent settle; unknown outcome settled pessimistically; provider overshoot audited and project halted; alerts fire once each; rollback reserves nothing |
| D2 idempotency | duplicate submit returns the stored result and never re-calls the provider; reservation row precedes the provider call; refused admission releases the key; dropped socket leaves the run unsettled; sweeper reconciles against the real outcome; unreconcilable run charges the full hold; sweeper cannot double-charge a settled run |
| D3 state machine | audit row written in the same transaction as every transition; undeclared transitions rejected; stale version and stale state both lose the race; `Halted` releases the artifact lease; expired decision deadline parks the task without choosing for the user |
| D4 leases | live lease blocks a second writer; expired lease reclaimable; **stale epoch write rejected after reclaim**; `LeaseLost` reported before `ArtifactConflict`; heartbeat extends then fails after reclaim; reviewers propose patches instead of taking the lease |
| D5 assignment | quality equals the prior at zero data and shifts as approvals accumulate; tight margin and high-risk tags force cross-review; ties broken deterministically by id; a user pin moves one factor rather than overriding the result |
| D6 review | verdict derived from criterion severities; safety refusal overrides; self-reported confidence stored but never gates a transition; revision allowance is finite |
| D7 context package | identical inputs produce an identical hash; file ordering cannot change it; oversized files summarized into inspectable `SUMMARY` artifacts; unshrinkable context fails loudly rather than truncating silently |

Two bugs were found by these tests rather than by review:

1. `ASSIGNED -> HALTED` was not a declared transition, but budget refusal happens at
   admission, before `RUNNING`. The task would have stayed `ASSIGNED` and been retried
   forever against an exhausted budget. Fixed in code and in the spec diagram.
2. A `failed` event with no usage and no output was charging the estimated input cost,
   billing the user for a rejected call that processed nothing.

## What is NOT verified

Honest accounting, because the environment made some of this impossible:

- **No real model call has ever been made.** No network egress to `api.openai.com` or
  `generativelanguage.googleapis.com`, and no API keys. Every test runs against
  `FakeAdapter`.
- **The OpenAI and Gemini adapters do not exist yet.** `src/ports/adapter.ts` defines
  the contract; the implementations are the first thing to write once keys and network
  are available, and the normalized event mapping is unproven until then.
- **`estimateTokens` is a 4-chars-per-token approximation**, not a real tokenizer. It
  feeds a worst-case reservation, so an underestimate is absorbed at settle time, but
  every adapter should replace it with provider-side token counting.
- **No Prisma implementation of the `Store` port.** `prisma validate` could not run
  offline, so `docs/modelroom/schema.prisma` is hand-verified only.
- **Transactions here are synchronous and single-process.** `MemoryStore` isolates via
  clone-and-swap. The concurrency claims (open holds blocking a third run, optimistic
  version checks, conditional lease acquire) are correct by construction but need
  re-verification under real `SERIALIZABLE` Postgres, especially the `availableMicros`
  read-then-insert in `admit`, which requires the transaction to actually be
  serializable rather than `READ COMMITTED`.
- **No HTTP layer, no SSE, no queue, no auth.** §12 endpoints and the `ProjectEvent`
  replay stream are specified but unimplemented.

## Layout

```
src/domain/     money, state tables, row shapes, normalized model events
src/ports/      Store/Tx, ModelAdapter, Clock  <- core depends only on these
src/core/       ledger, idempotency, taskMachine, lease, assignment, review,
                contextPackage, orchestrator, sweeper
src/infra/      memoryStore, fakeAdapter, hash
src/test/       one suite per core module
types/          hand-written node builtin shims (@types/node uninstallable)
```

The dependency rule: `core` imports from `domain` and `ports` only. Swapping
`MemoryStore` for a Prisma-backed `Store` should require no change under `src/core/`.
