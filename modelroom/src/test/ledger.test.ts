import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { admit, availableMicros, MIN_OUTPUT_TOKENS, settle } from "../core/ledger.ts";
import { BudgetExhausted, InvariantViolation } from "../core/errors.ts";
import { GPT, auditTypes, makeWorld, seedRun } from "./fixtures.ts";
import { usd } from "../domain/money.ts";

describe("D1 cost ledger", () => {
  test("admit reserves worst-case cost, making it unavailable to other runs", () => {
    const world = makeWorld({ budgetMicros: usd(1) });
    seedRun(world, { id: "run_a" });

    const cap = world.store.transaction((tx) =>
      admit(
        tx,
        { runId: "run_a", projectId: world.projectId, modelConfigId: GPT, estimatedInputTokens: 1_000, requestedMaxOutputTokens: 2_000 },
        world.clock,
      ),
    );

    // 1000 input * 3 + 2000 output * 15
    assert.equal(cap.maxOutputTokens, 2_000);
    assert.equal(cap.holdMicros, 33_000n);
    assert.equal(
      world.store.transaction((tx) => availableMicros(tx, world.projectId)),
      1_000_000n - 33_000n,
    );
  });

  test("output cap is derived from remaining budget, not from static config", () => {
    // Only $0.02 left: the model's 8000-token capability and the caller's 2000-token
    // request are both irrelevant if the money is not there.
    const world = makeWorld({ budgetMicros: 20_000n });
    seedRun(world, { id: "run_a" });

    const cap = world.store.transaction((tx) =>
      admit(
        tx,
        { runId: "run_a", projectId: world.projectId, modelConfigId: GPT, estimatedInputTokens: 1_000, requestedMaxOutputTokens: 2_000 },
        world.clock,
      ),
    );

    assert.equal(cap.maxOutputTokens, 1_133); // floor((20000 - 3000) / 15)
    assert.ok(cap.maxOutputTokens < 2_000);
    assert.ok(world.store.transaction((tx) => availableMicros(tx, world.projectId)) >= 0n);
  });

  test("admit refuses below the minimum viable output and halts the project", () => {
    const world = makeWorld({ budgetMicros: 10_000n });
    seedRun(world, { id: "run_a" });

    // Refusal is returned via throw, but the halt must survive, so the caller commits
    // the transaction. Here we assert both halves.
    const outcome = world.store.transaction((tx) => {
      try {
        admit(
          tx,
          { runId: "run_a", projectId: world.projectId, modelConfigId: GPT, estimatedInputTokens: 1_000, requestedMaxOutputTokens: 2_000 },
          world.clock,
        );
        return "admitted";
      } catch (error) {
        assert.ok(error instanceof BudgetExhausted);
        // 3000 fixed + 512 * 15
        assert.equal((error as BudgetExhausted).requiredMicros, 3_000n + BigInt(MIN_OUTPUT_TOKENS) * 15n);
        return "refused";
      }
    });

    assert.equal(outcome, "refused");
    assert.equal(world.store.db.projects[world.projectId]?.status, "HALTED_BUDGET");
    assert.ok(auditTypes(world).includes("PROJECT_HALTED_BUDGET"));
    assert.equal(world.store.db.ledger.length, 0, "a refused admission must not reserve anything");
  });

  test("open holds block a third run even though nothing has been spent yet", () => {
    const world = makeWorld({ budgetMicros: 70_000n });
    seedRun(world, { id: "run_a" });
    seedRun(world, { id: "run_b" });
    seedRun(world, { id: "run_c" });

    const admitRun = (runId: string) =>
      world.store.transaction((tx) =>
        admit(
          tx,
          { runId, projectId: world.projectId, modelConfigId: GPT, estimatedInputTokens: 1_000, requestedMaxOutputTokens: 2_000 },
          world.clock,
        ),
      );

    admitRun("run_a");
    admitRun("run_b");
    assert.equal(world.store.transaction((tx) => availableMicros(tx, world.projectId)), 4_000n);

    // This is the case a post-hoc budget check would let through: no SETTLE rows
    // exist yet, so "spent so far" is still zero.
    assert.throws(() => admitRun("run_c"), BudgetExhausted);
  });

  test("settle records actual cost and releases the unused reservation", () => {
    const world = makeWorld({ budgetMicros: usd(1) });
    seedRun(world, { id: "run_a" });
    world.store.transaction((tx) =>
      admit(
        tx,
        { runId: "run_a", projectId: world.projectId, modelConfigId: GPT, estimatedInputTokens: 1_000, requestedMaxOutputTokens: 2_000 },
        world.clock,
      ),
    );

    const result = world.store.transaction((tx) =>
      settle(tx, { runId: "run_a", outcome: "COMPLETED", inputTokens: 1_000, outputTokens: 500 }, world.clock),
    );

    assert.equal(result.settledMicros, 10_500n); // 3000 + 500 * 15
    assert.equal(result.releasedMicros, 22_500n);
    assert.equal(result.overshotMicros, 0n);
    assert.equal(
      world.store.transaction((tx) => availableMicros(tx, world.projectId)),
      1_000_000n - 10_500n,
    );
    assert.equal(world.store.db.runs["run_a"]?.status, "COMPLETED");
    assert.equal(world.store.db.runs["run_a"]?.costMicros, 10_500n);
  });

  test("settle is idempotent, because the worker and the sweeper can race", () => {
    const world = makeWorld({ budgetMicros: usd(1) });
    seedRun(world, { id: "run_a" });
    world.store.transaction((tx) =>
      admit(
        tx,
        { runId: "run_a", projectId: world.projectId, modelConfigId: GPT, estimatedInputTokens: 1_000, requestedMaxOutputTokens: 2_000 },
        world.clock,
      ),
    );

    const first = world.store.transaction((tx) =>
      settle(tx, { runId: "run_a", outcome: "COMPLETED", inputTokens: 1_000, outputTokens: 500 }, world.clock),
    );
    const second = world.store.transaction((tx) =>
      settle(tx, { runId: "run_a", outcome: "COMPLETED", inputTokens: 1_000, outputTokens: 500 }, world.clock),
    );

    assert.equal(first.alreadySettled, false);
    assert.equal(second.alreadySettled, true);
    assert.equal(second.settledMicros, first.settledMicros);
    assert.equal(
      world.store.transaction((tx) => availableMicros(tx, world.projectId)),
      1_000_000n - 10_500n,
      "double settle must not charge twice",
    );
  });

  test("an unknown outcome settles the full hold rather than releasing it", () => {
    const world = makeWorld({ budgetMicros: usd(1) });
    seedRun(world, { id: "run_a" });
    world.store.transaction((tx) =>
      admit(
        tx,
        { runId: "run_a", projectId: world.projectId, modelConfigId: GPT, estimatedInputTokens: 1_000, requestedMaxOutputTokens: 2_000 },
        world.clock,
      ),
    );

    const result = world.store.transaction((tx) =>
      settle(tx, { runId: "run_a", outcome: "UNKNOWN", inputTokens: 0, outputTokens: 0 }, world.clock),
    );

    // The provider may already have charged. Releasing here is how budgets leak.
    assert.equal(result.settledMicros, 33_000n);
    assert.equal(result.releasedMicros, 0n);
    assert.equal(world.store.db.runs["run_a"]?.status, "UNKNOWN");
  });

  test("a provider that overshoots the cap is audited and halts the project", () => {
    const world = makeWorld({ budgetMicros: 40_000n });
    seedRun(world, { id: "run_a" });
    world.store.transaction((tx) =>
      admit(
        tx,
        { runId: "run_a", projectId: world.projectId, modelConfigId: GPT, estimatedInputTokens: 1_000, requestedMaxOutputTokens: 2_000 },
        world.clock,
      ),
    );

    const result = world.store.transaction((tx) =>
      settle(tx, { runId: "run_a", outcome: "COMPLETED", inputTokens: 1_000, outputTokens: 5_000 }, world.clock),
    );

    assert.equal(result.settledMicros, 78_000n); // truth wins over the reservation
    assert.equal(result.overshotMicros, 45_000n);
    assert.ok(auditTypes(world).includes("BUDGET_OVERSHOOT"));
    assert.ok(world.store.transaction((tx) => availableMicros(tx, world.projectId)) < 0n);
    assert.equal(world.store.db.projects[world.projectId]?.status, "HALTED_BUDGET");
  });

  test("a failed run with no usage releases the whole reservation", () => {
    const world = makeWorld({ budgetMicros: usd(1) });
    seedRun(world, { id: "run_a" });
    world.store.transaction((tx) =>
      admit(
        tx,
        { runId: "run_a", projectId: world.projectId, modelConfigId: GPT, estimatedInputTokens: 1_000, requestedMaxOutputTokens: 2_000 },
        world.clock,
      ),
    );

    const result = world.store.transaction((tx) =>
      settle(tx, { runId: "run_a", outcome: "FAILED", inputTokens: 0, outputTokens: 0, errorCode: "RATE_LIMIT" }, world.clock),
    );

    assert.equal(result.settledMicros, 0n);
    assert.equal(result.releasedMicros, 33_000n);
    assert.equal(world.store.transaction((tx) => availableMicros(tx, world.projectId)), 1_000_000n);
  });

  test("settling a run that never reserved is a loud programming error", () => {
    const world = makeWorld();
    seedRun(world, { id: "run_orphan" });

    assert.throws(
      () =>
        world.store.transaction((tx) =>
          settle(tx, { runId: "run_orphan", outcome: "COMPLETED", inputTokens: 10, outputTokens: 10 }, world.clock),
        ),
      InvariantViolation,
    );
  });

  test("alerts fire on reserved money, and each threshold fires at most once", () => {
    // 33000 held against a 36000 budget is 91%, so admission alone crosses both 70
    // and 90. That is the intended behaviour: reserved money counts as spent.
    const world = makeWorld({ budgetMicros: 36_000n });
    seedRun(world, { id: "run_a" });

    world.store.transaction((tx) =>
      admit(
        tx,
        { runId: "run_a", projectId: world.projectId, modelConfigId: GPT, estimatedInputTokens: 1_000, requestedMaxOutputTokens: 2_000 },
        world.clock,
      ),
    );
    assert.deepEqual(firedAlerts(world), [70, 90]);

    // Settling at exactly the reserved amount keeps the ratio at 91%, so no alert
    // may repeat even though fireBudgetAlerts runs again.
    world.store.transaction((tx) =>
      settle(tx, { runId: "run_a", outcome: "COMPLETED", inputTokens: 1_000, outputTokens: 2_000 }, world.clock),
    );
    assert.deepEqual(firedAlerts(world), [70, 90], "settle must not re-fire crossed thresholds");
  });

  function firedAlerts(world: ReturnType<typeof makeWorld>): unknown[] {
    return world.store.db.audit
      .filter((a) => a.eventType === "BUDGET_ALERT")
      .map((a) => a.payload["thresholdPct"]);
  }

  test("a rolled back transaction reserves nothing", () => {
    const world = makeWorld({ budgetMicros: usd(1) });
    seedRun(world, { id: "run_a" });

    assert.throws(() =>
      world.store.transaction((tx) => {
        admit(
          tx,
          { runId: "run_a", projectId: world.projectId, modelConfigId: GPT, estimatedInputTokens: 1_000, requestedMaxOutputTokens: 2_000 },
          world.clock,
        );
        throw new Error("something later in the handler failed");
      }),
    );

    assert.equal(world.store.db.ledger.length, 0);
    assert.equal(world.store.transaction((tx) => availableMicros(tx, world.projectId)), 1_000_000n);
  });
});
