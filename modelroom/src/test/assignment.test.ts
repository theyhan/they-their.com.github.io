import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { FORCED_REVIEW_MARGIN, overrideAssignment, recordAssignment, scoreAssignment, shrunkQuality } from "../core/assignment.ts";
import { GEMINI, GPT, gptConfig, makeWorld, setStats } from "./fixtures.ts";

describe("D5 assignment scoring", () => {
  test("with zero history, quality equals the configured prior", () => {
    // v1.0's formula was undefined here: 20% of the score had no data behind it.
    const world = makeWorld({ capabilityTags: ["coding"] });

    const gptQuality = world.store.transaction((tx) => shrunkQuality(tx, GPT, "coding", 0.7));
    const geminiQuality = world.store.transaction((tx) => shrunkQuality(tx, GEMINI, "coding", 0.5));

    assert.equal(gptQuality, 0.7);
    assert.equal(geminiQuality, 0.5);
  });

  test("observed approvals pull quality away from the prior as data accumulates", () => {
    const world = makeWorld();
    setStats(world, GPT, "coding", { n: 40, approvals: 36 });

    // (36 + 10 * 0.7) / (40 + 10) = 0.86, between the 0.7 prior and the 0.9 observed
    // rate, and closer to observation as n grows.
    assert.equal(world.store.transaction((tx) => shrunkQuality(tx, GPT, "coding", 0.7)), 0.86);
  });

  test("the coding task goes to GPT and is cross-reviewed by Gemini", () => {
    const world = makeWorld({ capabilityTags: ["coding"] });

    const result = world.store.transaction((tx) =>
      scoreAssignment(tx, {
        capabilityTags: ["coding"],
        candidates: [
          { modelConfigId: GPT, estimatedCostMicros: 100n },
          { modelConfigId: GEMINI, estimatedCostMicros: 50n },
        ],
      }),
    );

    assert.equal(result.chosenModelId, GPT);
    assert.equal(result.reviewerModelId, GEMINI);
    assert.equal(result.breakdown[GPT]?.capability, 0.9);
    assert.equal(result.breakdown[GPT]?.quality, 0.7);
    // GPT is the pricier model, so it scores 0 on cost and still wins on capability.
    assert.equal(result.breakdown[GPT]?.cost, 0);
    assert.equal(result.breakdown[GEMINI]?.cost, 0.5);
    assert.equal(result.forcedReview, true);
  });

  test("a close call forces cross-review because the engine does not trust itself", () => {
    const world = makeWorld();

    const result = world.store.transaction((tx) =>
      scoreAssignment(tx, {
        capabilityTags: ["coding"],
        candidates: [
          { modelConfigId: GPT, estimatedCostMicros: 100n },
          { modelConfigId: GEMINI, estimatedCostMicros: 50n },
        ],
      }),
    );

    assert.ok(result.scoreMargin < FORCED_REVIEW_MARGIN, `margin ${result.scoreMargin} should be tight`);
    assert.equal(result.forcedReview, true);
    assert.equal(result.forcedReviewReason, "LOW_CONFIDENCE_MARGIN");
  });

  test("a high-risk tag forces review even when the winner is obvious", () => {
    const world = makeWorld();

    const result = world.store.transaction((tx) =>
      scoreAssignment(tx, {
        capabilityTags: ["final_synthesis"],
        candidates: [
          { modelConfigId: GPT, estimatedCostMicros: 100n },
          { modelConfigId: GEMINI, estimatedCostMicros: 100n },
        ],
      }),
    );

    assert.equal(result.chosenModelId, GPT);
    assert.ok(result.scoreMargin > FORCED_REVIEW_MARGIN);
    assert.equal(result.forcedReview, true);
    assert.equal(result.forcedReviewReason, "HIGH_RISK_TAG:final_synthesis");
  });

  test("a clear winner on a low-risk tag runs unreviewed", () => {
    const world = makeWorld();

    const result = world.store.transaction((tx) =>
      scoreAssignment(tx, {
        capabilityTags: ["image_understanding"],
        candidates: [
          { modelConfigId: GPT, estimatedCostMicros: 100n },
          { modelConfigId: GEMINI, estimatedCostMicros: 100n },
        ],
      }),
    );

    assert.equal(result.chosenModelId, GEMINI);
    assert.equal(result.forcedReview, false);
    assert.equal(result.reviewerModelId, null);
  });

  test("identical candidates are ranked deterministically rather than by object order", () => {
    // Exactly the situation on a fresh install with two comparably configured models.
    const world = makeWorld();
    world.store.db.modelConfigs["mc_clone"] = { ...gptConfig(), id: "mc_clone" };

    const score = () =>
      world.store.transaction((tx) =>
        scoreAssignment(tx, {
          capabilityTags: ["coding"],
          candidates: [
            { modelConfigId: GPT, estimatedCostMicros: 100n },
            { modelConfigId: "mc_clone", estimatedCostMicros: 100n },
          ],
        }),
      );

    const first = score();
    const second = score();

    assert.equal(first.scoreMargin, 0);
    assert.equal(first.chosenModelId, "mc_clone", "ties break on id, not insertion order");
    assert.equal(second.chosenModelId, first.chosenModelId);
    assert.equal(first.forcedReview, true);
  });

  test("a user pin moves the preference factor without silently faking capability", () => {
    const world = makeWorld();

    const pinned = world.store.transaction((tx) =>
      scoreAssignment(tx, {
        capabilityTags: ["image_understanding"],
        candidates: [
          { modelConfigId: GPT, estimatedCostMicros: 100n },
          { modelConfigId: GEMINI, estimatedCostMicros: 100n },
        ],
        pinnedModelConfigId: GPT,
      }),
    );

    assert.equal(pinned.breakdown[GPT]?.preference, 1);
    assert.equal(pinned.breakdown[GEMINI]?.preference, 0);
    // A pin is 10% of the score, not an override: Gemini still wins image work. The
    // user's explicit override path is overrideAssignment, not the scorer.
    assert.equal(pinned.chosenModelId, GEMINI);
  });

  test("the proposal is persisted, and a user override is flagged for the retention KPI", () => {
    const world = makeWorld();

    const result = world.store.transaction((tx) => {
      const scored = scoreAssignment(tx, {
        capabilityTags: ["coding"],
        candidates: [
          { modelConfigId: GPT, estimatedCostMicros: 100n },
          { modelConfigId: GEMINI, estimatedCostMicros: 50n },
        ],
      });
      recordAssignment(tx, world.taskId, scored, world.clock);
      return scored;
    });

    assert.equal(world.store.db.tasks[world.taskId]?.assigneeModelId, result.chosenModelId);
    assert.equal(world.store.db.assignments[0]?.overriddenByUser, false);

    world.store.transaction((tx) =>
      overrideAssignment(tx, world.taskId, { assigneeModelId: GEMINI }, "usr_1", world.clock),
    );

    assert.equal(world.store.db.tasks[world.taskId]?.assigneeModelId, GEMINI);
    assert.equal(world.store.db.assignments[0]?.overriddenByUser, true);
    assert.ok(world.store.db.audit.some((a) => a.eventType === "ASSIGNMENT_OVERRIDDEN"));
  });
});
