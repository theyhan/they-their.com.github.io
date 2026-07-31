import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { DECISION_DEADLINE_MS, expireStaleDecisions, transition } from "../core/taskMachine.ts";
import { acquireLease } from "../core/lease.ts";
import { ConcurrentTransition, IllegalTransition } from "../core/errors.ts";
import { auditTypes, makeWorld, seedArtifact, seedRun } from "./fixtures.ts";

describe("D3 task state machine", () => {
  test("a legal transition bumps the version and writes an audit row atomically", () => {
    const world = makeWorld({ taskStatus: "ASSIGNED" });

    const updated = world.store.transaction((tx) =>
      transition(tx, { taskId: world.taskId, from: ["ASSIGNED"], to: "RUNNING", cause: "RUN_ADMITTED" }, world.clock),
    );

    assert.equal(updated.status, "RUNNING");
    assert.equal(updated.version, 1);

    const audit = world.store.db.audit.filter((a) => a.eventType === "TASK_TRANSITION");
    assert.equal(audit.length, 1);
    assert.equal(audit[0]?.payload["from"], "ASSIGNED");
    assert.equal(audit[0]?.payload["to"], "RUNNING");
  });

  test("an undeclared transition is rejected", () => {
    const world = makeWorld({ taskStatus: "PLANNED" });

    assert.throws(
      () =>
        world.store.transaction((tx) =>
          transition(tx, { taskId: world.taskId, from: ["PLANNED"], to: "COMPLETED", cause: "shortcut" }, world.clock),
        ),
      IllegalTransition,
    );
    assert.equal(world.store.db.tasks[world.taskId]?.status, "PLANNED");
    assert.equal(world.store.db.audit.length, 0, "a rejected transition must not leave an audit row");
  });

  test("a stale version loses the race instead of overwriting", () => {
    const world = makeWorld({ taskStatus: "ASSIGNED" });
    world.store.transaction((tx) =>
      transition(tx, { taskId: world.taskId, from: ["ASSIGNED"], to: "RUNNING", cause: "first" }, world.clock),
    );

    assert.throws(
      () =>
        world.store.transaction((tx) =>
          transition(
            tx,
            { taskId: world.taskId, from: ["RUNNING"], to: "REVIEW", cause: "second", expectedVersion: 0 },
            world.clock,
          ),
        ),
      ConcurrentTransition,
    );
  });

  test("acting on a state the task has already left loses the race", () => {
    const world = makeWorld({ taskStatus: "RUNNING" });

    assert.throws(
      () =>
        world.store.transaction((tx) =>
          transition(tx, { taskId: world.taskId, from: ["ASSIGNED"], to: "RUNNING", cause: "stale read" }, world.clock),
        ),
      ConcurrentTransition,
    );
  });

  test("entering Halted releases the artifact lease", () => {
    // This is the whole reason Halted is not just Cancelled: the task is resumable,
    // but it must not sit on an artifact lock while it waits.
    const world = makeWorld({ taskStatus: "RUNNING" });
    seedArtifact(world, "art_1");
    seedRun(world, { id: "run_a" });
    world.store.transaction((tx) => acquireLease(tx, "art_1", "run_a", world.clock));
    assert.ok(world.store.db.leases["art_1"]);

    world.store.transaction((tx) =>
      transition(
        tx,
        { taskId: world.taskId, from: ["RUNNING"], to: "HALTED", cause: "BUDGET_EXHAUSTED", haltReason: "BUDGET_EXHAUSTED" },
        world.clock,
      ),
    );

    assert.equal(world.store.db.leases["art_1"], undefined);
    assert.equal(world.store.db.artifacts["art_1"]?.activeWriterRunId, null);
    assert.equal(world.store.db.tasks[world.taskId]?.haltReason, "BUDGET_EXHAUSTED");
    assert.ok(auditTypes(world).includes("LEASE_RELEASED"));
  });

  test("entering Running keeps the lease, entering Review gives it up", () => {
    const world = makeWorld({ taskStatus: "RUNNING" });
    seedArtifact(world, "art_1");
    seedRun(world, { id: "run_a" });
    world.store.transaction((tx) => acquireLease(tx, "art_1", "run_a", world.clock));

    world.store.transaction((tx) =>
      transition(tx, { taskId: world.taskId, from: ["RUNNING"], to: "REVIEW", cause: "RUN_COMPLETED" }, world.clock),
    );

    assert.equal(world.store.db.leases["art_1"], undefined, "a reviewer must not inherit the write lease");
  });

  test("USER_DECISION sets a deadline and clearing the state clears it", () => {
    const world = makeWorld({ taskStatus: "REVIEW" });

    world.store.transaction((tx) =>
      transition(tx, { taskId: world.taskId, from: ["REVIEW"], to: "USER_DECISION", cause: "models disagree" }, world.clock),
    );
    assert.equal(world.store.db.tasks[world.taskId]?.decisionDeadlineAt, world.clock.now() + DECISION_DEADLINE_MS);

    world.store.transaction((tx) =>
      transition(tx, { taskId: world.taskId, from: ["USER_DECISION"], to: "APPROVED", cause: "user chose A" }, world.clock),
    );
    assert.equal(world.store.db.tasks[world.taskId]?.decisionDeadlineAt, null);
  });

  test("an expired decision parks the task without choosing for the user", () => {
    const world = makeWorld({ taskStatus: "REVIEW" });
    world.store.transaction((tx) =>
      transition(tx, { taskId: world.taskId, from: ["REVIEW"], to: "USER_DECISION", cause: "models disagree" }, world.clock),
    );

    // One millisecond before the deadline: still waiting.
    world.clock.advance(DECISION_DEADLINE_MS - 1);
    assert.deepEqual(
      world.store.transaction((tx) => expireStaleDecisions(tx, world.projectId, world.clock)),
      [],
    );
    assert.equal(world.store.db.tasks[world.taskId]?.status, "USER_DECISION");

    world.clock.advance(2);
    const expired = world.store.transaction((tx) => expireStaleDecisions(tx, world.projectId, world.clock));

    assert.deepEqual(expired, [world.taskId]);
    assert.equal(world.store.db.tasks[world.taskId]?.status, "HALTED");
    assert.equal(world.store.db.tasks[world.taskId]?.haltReason, "DECISION_DEADLINE_EXPIRED");
    // Silently adopting a model's answer would corrupt the decision history.
    assert.equal(world.store.db.reviews.length, 0);
    assert.equal(
      world.store.db.audit.filter((a) => a.payload["to"] === "APPROVED").length,
      0,
      "an expired deadline must never auto-approve",
    );
  });
});
