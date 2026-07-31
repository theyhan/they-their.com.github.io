import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { Orchestrator, type ExecuteRunInput } from "../core/orchestrator.ts";
import { availableMicros } from "../core/ledger.ts";
import { reconcileStaleRuns, RUN_TIMEOUT_MS, type ProviderRunOutcome } from "../core/sweeper.ts";
import { FakeAdapter, truncatingSummarizer } from "../infra/fakeAdapter.ts";
import { GPT, auditTypes, makeWorld, type World } from "./fixtures.ts";
import { usd } from "../domain/money.ts";

function runInput(world: World, overrides: Partial<ExecuteRunInput> = {}): ExecuteRunInput {
  return {
    taskId: world.taskId,
    modelConfigId: GPT,
    idempotencyKey: "idem_1",
    requestedMaxOutputTokens: 2_000,
    systemInstruction: "You are the assignee.",
    context: {
      projectGoal: "Build a landing page",
      completionCriteria: ["renders on mobile"],
      reviewCriteria: ["requirement_coverage"],
      decisions: [],
      counterpartDeliverable: null,
      files: [],
      remainingRounds: 1,
    },
    ...overrides,
  };
}

function orchestrator(world: World, adapter: FakeAdapter): Orchestrator {
  return new Orchestrator({
    store: world.store,
    clock: world.clock,
    summarizer: truncatingSummarizer,
    adapters: { OPENAI: adapter },
  });
}

describe("orchestrator run lifecycle", () => {
  test("a successful run settles actual cost and moves the task to review", async () => {
    const world = makeWorld({ budgetMicros: usd(1) });
    const adapter = new FakeAdapter("OPENAI", {
      chunks: ["export function Hero() {", " return null }"],
      usage: { inputTokens: 120, outputTokens: 40 },
    });

    const result = await orchestrator(world, adapter).executeRun(runInput(world));

    assert.equal(result.status, "COMPLETED");
    assert.equal(result.costMicros, 960n); // 120 * 3 + 40 * 15
    assert.equal(result.indeterminate, false);
    assert.equal(world.store.db.tasks[world.taskId]?.status, "REVIEW");

    const run = world.store.db.runs[result.runId ?? ""];
    assert.equal(run?.status, "COMPLETED");
    assert.ok(run?.providerRequestId, "the provider handle must be persisted");
    assert.ok(run?.contextPackageId, "the run must point at the exact package it was sent");
    assert.equal(world.store.transaction((tx) => availableMicros(tx, world.projectId)), usd(1) - 960n);
  });

  test("the reservation exists before the provider is ever called", async () => {
    const world = makeWorld({ budgetMicros: usd(1) });
    const adapter = new FakeAdapter("OPENAI", { chunks: ["ok"], usage: { inputTokens: 100, outputTokens: 10 } });

    await orchestrator(world, adapter).executeRun(runInput(world));

    const ledger = world.store.db.ledger;
    assert.equal(ledger[0]?.type, "HOLD", "the first ledger entry must be the reservation");
    assert.ok(ledger.some((r) => r.type === "SETTLE"));
    assert.ok(ledger.some((r) => r.type === "RELEASE"));
  });

  test("replaying an idempotency key returns the stored result without a second charge", async () => {
    const world = makeWorld({ budgetMicros: usd(1) });
    const adapter = new FakeAdapter("OPENAI", {
      chunks: ["hello"],
      usage: { inputTokens: 120, outputTokens: 40 },
    });
    const orc = orchestrator(world, adapter);

    const first = await orc.executeRun(runInput(world));
    const second = await orc.executeRun(runInput(world));

    assert.equal(first.replayed, false);
    assert.equal(second.replayed, true);
    assert.equal(second.costMicros, first.costMicros);
    assert.equal(Object.keys(world.store.db.runs).length, 1, "a duplicate submit must not create a second run");
    assert.equal(world.store.db.ledger.filter((r) => r.type === "SETTLE").length, 1);
    assert.equal(adapter.turns.length, 1, "the provider must not be called twice");
  });

  test("output past the cap is cancelled worker-side, not trusted to the provider", async () => {
    const world = makeWorld({ budgetMicros: usd(1) });
    const adapter = new FakeAdapter("OPENAI", {
      // ignoreOutputCap models a provider that does not honour max_output_tokens.
      ignoreOutputCap: true,
      chunks: ["z".repeat(400), "z".repeat(400)],
      usage: { inputTokens: 100, outputTokens: 200 },
    });

    const result = await orchestrator(world, adapter).executeRun(
      runInput(world, { requestedMaxOutputTokens: 10 }),
    );

    assert.equal(result.outputCapHit, true);
    assert.equal(result.status, "CANCELLED");
    assert.deepEqual(adapter.cancelled, [result.runId]);
    assert.equal(world.store.db.tasks[world.taskId]?.status, "FAILED");
  });

  test("a provider failure event settles and fails the task", async () => {
    const world = makeWorld({ budgetMicros: usd(1) });
    const adapter = new FakeAdapter("OPENAI", {
      fail: { code: "RATE_LIMIT", message: "slow down", retryable: true },
      usage: null,
    });

    const result = await orchestrator(world, adapter).executeRun(runInput(world));

    assert.equal(result.status, "FAILED");
    assert.equal(world.store.db.runs[result.runId ?? ""]?.errorCode, "RATE_LIMIT");
    assert.equal(world.store.db.tasks[world.taskId]?.status, "FAILED");
    // Known failure with no usage: the whole reservation comes back.
    assert.equal(world.store.transaction((tx) => availableMicros(tx, world.projectId)), usd(1));
  });

  test("budget exhaustion refuses before any run exists and the halt survives", async () => {
    const world = makeWorld({ budgetMicros: 5_000n });
    const adapter = new FakeAdapter("OPENAI", { chunks: ["hello"] });

    const result = await orchestrator(world, adapter).executeRun(runInput(world));

    assert.equal(result.status, "REFUSED");
    assert.equal(result.refusalReason, "BUDGET_EXHAUSTED");
    assert.equal(Object.keys(world.store.db.runs).length, 0);
    assert.equal(adapter.turns.length, 0, "the provider must never be contacted");
    // The halt is the record that stops the project being run again, so it must be
    // committed even though the operation "failed".
    assert.equal(world.store.db.projects[world.projectId]?.status, "HALTED_BUDGET");
    assert.equal(world.store.db.tasks[world.taskId]?.status, "HALTED");
    assert.ok(auditTypes(world).includes("PROJECT_HALTED_BUDGET"));
  });

  test("a refused run releases its idempotency key so a funded retry can proceed", async () => {
    const world = makeWorld({ budgetMicros: 5_000n });
    const adapter = new FakeAdapter("OPENAI", { chunks: ["hello"], usage: { inputTokens: 100, outputTokens: 10 } });
    const orc = orchestrator(world, adapter);

    await orc.executeRun(runInput(world));

    // The user raises the budget and un-halts, then retries with the same key.
    world.store.db.projects[world.projectId]!.budgetLimitMicros = usd(1);
    world.store.db.projects[world.projectId]!.status = "RUNNING";
    world.store.db.tasks[world.taskId]!.status = "ASSIGNED";

    const retried = await orc.executeRun(runInput(world));

    assert.equal(retried.status, "COMPLETED");
    assert.equal(retried.replayed, false);
  });
});

describe("D2 indeterminate runs and reconciliation", () => {
  test("a dropped socket leaves the run unsettled rather than guessing", async () => {
    const world = makeWorld({ budgetMicros: usd(1) });
    const adapter = new FakeAdapter("OPENAI", { dropAfterAccept: true });

    const result = await orchestrator(world, adapter).executeRun(runInput(world));

    assert.equal(result.indeterminate, true);
    assert.equal(result.status, "PENDING");
    const run = world.store.db.runs[result.runId ?? ""];
    // The handle survived even though the stream did not: that is what makes
    // reconciliation possible at all.
    assert.ok(run?.providerRequestId);
    assert.equal(run?.status, "STREAMING");
    assert.equal(world.store.db.ledger.filter((r) => r.type === "SETTLE").length, 0);
    assert.ok(auditTypes(world).includes("RUN_INDETERMINATE"));
  });

  test("the sweeper settles an indeterminate run against the provider's real outcome", async () => {
    const world = makeWorld({ budgetMicros: usd(1) });
    const adapter = new FakeAdapter("OPENAI", { dropAfterAccept: true });
    const result = await orchestrator(world, adapter).executeRun(runInput(world));

    world.clock.advance(RUN_TIMEOUT_MS * 2);
    const outcome: ProviderRunOutcome = { status: "COMPLETED", inputTokens: 120, outputTokens: 40 };
    const sweep = await reconcileStaleRuns(world.store, world.clock, { lookup: async () => outcome });

    assert.deepEqual(sweep.reconciled, [result.runId]);
    assert.deepEqual(sweep.unknown, []);
    assert.equal(world.store.db.runs[result.runId ?? ""]?.status, "COMPLETED");
    assert.equal(world.store.db.runs[result.runId ?? ""]?.costMicros, 960n);
    assert.ok(auditTypes(world).includes("RUN_RECONCILED"));
  });

  test("the sweeper does not touch a run that is still within its timeout", async () => {
    const world = makeWorld({ budgetMicros: usd(1) });
    const adapter = new FakeAdapter("OPENAI", { dropAfterAccept: true });
    await orchestrator(world, adapter).executeRun(runInput(world));

    const sweep = await reconcileStaleRuns(world.store, world.clock, { lookup: async () => undefined });

    assert.deepEqual(sweep.reconciled, []);
    assert.deepEqual(sweep.unknown, []);
  });

  test("an unreconcilable run settles the full hold, because the provider may have billed", async () => {
    const world = makeWorld({ budgetMicros: usd(1) });
    // No accepted event: we never learned a provider handle, so the outcome cannot be
    // looked up. This is the worst case and the one that must not release money.
    const adapter = new FakeAdapter("OPENAI", { providerRequestId: null, dropAfterAccept: true });
    const result = await orchestrator(world, adapter).executeRun(runInput(world));

    assert.equal(world.store.db.runs[result.runId ?? ""]?.providerRequestId, null);

    world.clock.advance(RUN_TIMEOUT_MS * 2);
    const sweep = await reconcileStaleRuns(world.store, world.clock, { lookup: async () => undefined });

    assert.deepEqual(sweep.unknown, [result.runId]);
    assert.equal(world.store.db.runs[result.runId ?? ""]?.status, "UNKNOWN");

    const held = world.store.db.ledger.find((r) => r.type === "HOLD")?.amountMicros ?? 0n;
    const settled = world.store.db.ledger.filter((r) => r.type === "SETTLE").reduce((a, r) => a + r.amountMicros, 0n);
    assert.equal(settled, held, "the entire reservation is charged, not released");
    assert.ok(auditTypes(world).includes("RUN_UNRECONCILABLE"));
  });

  test("a lookup that throws is treated as unknown, not as success", async () => {
    const world = makeWorld({ budgetMicros: usd(1) });
    const adapter = new FakeAdapter("OPENAI", { dropAfterAccept: true });
    const result = await orchestrator(world, adapter).executeRun(runInput(world));

    world.clock.advance(RUN_TIMEOUT_MS * 2);
    const sweep = await reconcileStaleRuns(world.store, world.clock, {
      lookup: async () => {
        throw new Error("provider API unavailable");
      },
    });

    assert.deepEqual(sweep.unknown, [result.runId]);
    assert.equal(world.store.db.runs[result.runId ?? ""]?.status, "UNKNOWN");
  });

  test("the sweeper cannot double-charge a run the worker already settled", async () => {
    const world = makeWorld({ budgetMicros: usd(1) });
    const adapter = new FakeAdapter("OPENAI", { chunks: ["ok"], usage: { inputTokens: 120, outputTokens: 40 } });
    const result = await orchestrator(world, adapter).executeRun(runInput(world));

    // Force the run back into a sweepable state to simulate the race directly.
    world.store.db.runs[result.runId ?? ""]!.status = "STREAMING";
    world.clock.advance(RUN_TIMEOUT_MS * 2);

    await reconcileStaleRuns(world.store, world.clock, {
      lookup: async () => ({ status: "COMPLETED", inputTokens: 120, outputTokens: 40 }),
    });

    assert.equal(world.store.db.ledger.filter((r) => r.type === "SETTLE").length, 1);
    assert.equal(world.store.transaction((tx) => availableMicros(tx, world.projectId)), usd(1) - 960n);
  });
});
