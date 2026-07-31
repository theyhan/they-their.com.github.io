import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { aggregateVerdict, criteriaForTaskType, nextStateForVerdict, recordReview } from "../core/review.ts";
import { makeWorld, seedRun } from "./fixtures.ts";

const pass = (key: string) => ({ criterionKey: key, passed: true, evidence: "ok", severity: "INFO" as const });

describe("D6 review verdicts", () => {
  test("a blocker sends the decision to a human", () => {
    const verdict = aggregateVerdict([
      pass("requirement_coverage"),
      { criterionKey: "sensitive_info_absent", passed: false, evidence: "line 12 contains an API key", severity: "BLOCKER" },
    ]);
    assert.equal(verdict, "USER_DECISION");
  });

  test("a major failure triggers a revision", () => {
    const verdict = aggregateVerdict([
      pass("code_validity"),
      { criterionKey: "requirement_coverage", passed: false, evidence: "no mobile layout", severity: "MAJOR" },
    ]);
    assert.equal(verdict, "REVISION");
  });

  test("minor failures still pass", () => {
    const verdict = aggregateVerdict([
      { criterionKey: "citations_present", passed: false, evidence: "one link missing", severity: "MINOR" },
      pass("requirement_coverage"),
    ]);
    assert.equal(verdict, "PASS");
  });

  test("severity on a passing criterion is ignored", () => {
    const verdict = aggregateVerdict([
      { criterionKey: "sensitive_info_absent", passed: true, evidence: "none found", severity: "BLOCKER" },
    ]);
    assert.equal(verdict, "PASS");
  });

  test("a safety refusal overrides the checklist and is persisted", () => {
    const world = makeWorld();
    seedRun(world, { id: "run_reviewer" });

    const review = world.store.transaction((tx) =>
      recordReview(
        tx,
        {
          taskId: world.taskId,
          reviewerRunId: "run_reviewer",
          round: 0,
          criteria: [pass("requirement_coverage")],
          safetyRefusal: { reason: "requested content violates policy" },
        },
        world.clock,
      ),
    );

    assert.equal(review.verdict, "BLOCKED_SAFETY");
    assert.equal(world.store.db.reviews.length, 1);
    assert.ok(world.store.db.audit.some((a) => a.eventType === "REVIEW_RECORDED"));
  });

  test("self-reported confidence is stored but never changes the verdict", () => {
    const world = makeWorld();
    seedRun(world, { id: "run_reviewer" });

    const review = world.store.transaction((tx) =>
      recordReview(
        tx,
        {
          taskId: world.taskId,
          reviewerRunId: "run_reviewer",
          round: 0,
          // A model claiming 3% confidence while every criterion passes must not be
          // able to escalate: confidence is not comparable across providers.
          confidence: 0.03,
          criteria: [pass("requirement_coverage"), pass("code_validity")],
        },
        world.clock,
      ),
    );

    assert.equal(review.verdict, "PASS");
    assert.equal(review.confidence, 0.03);
  });

  test("criterion results are persisted with their evidence", () => {
    const world = makeWorld();
    seedRun(world, { id: "run_reviewer" });

    world.store.transaction((tx) =>
      recordReview(
        tx,
        {
          taskId: world.taskId,
          reviewerRunId: "run_reviewer",
          round: 1,
          criteria: [
            { criterionKey: "requirement_coverage", passed: false, evidence: "\"hero\" section absent", severity: "MAJOR" },
          ],
        },
        world.clock,
      ),
    );

    assert.equal(world.store.db.criteriaResults.length, 1);
    assert.equal(world.store.db.criteriaResults[0]?.evidence, '"hero" section absent');
    assert.equal(world.store.db.criteriaResults[0]?.severity, "MAJOR");
  });

  test("the revision allowance is finite: a second REVISION becomes a user decision", () => {
    assert.equal(nextStateForVerdict("PASS", 0, 1), "APPROVED");
    assert.equal(nextStateForVerdict("REVISION", 0, 1), "REVISION");
    // Round 1 of 1 is spent, so the loop terminates in a human decision (§7.1).
    assert.equal(nextStateForVerdict("REVISION", 1, 1), "USER_DECISION");
    assert.equal(nextStateForVerdict("BLOCKED_SAFETY", 0, 1), "USER_DECISION");
  });

  test("criteria are seeded per task type with a documented fallback", () => {
    assert.ok(criteriaForTaskType("code").includes("code_validity"));
    assert.ok(criteriaForTaskType("document").includes("citations_present"));
    assert.deepEqual(criteriaForTaskType("unknown_type"), criteriaForTaskType("document"));
  });
});
