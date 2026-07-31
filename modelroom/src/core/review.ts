// Spec v1.1 D6: a verdict is the aggregation of a seeded checklist, not a free-form
// model opinion.
//
// v1.0 defines PASS / REVISION / USER_DECISION in §17 but gives them nowhere to live
// and no derivation rule, which would leave the most consequential control in the
// product ("should a human look at this?") to whatever the reviewing model felt like
// emitting that turn.

import type { CriterionResultRow, ReviewRow } from "../domain/rows.ts";
import type { ReviewVerdict, Severity } from "../domain/states.ts";
import type { Clock } from "../ports/clock.ts";
import type { Tx } from "../ports/store.ts";
import { NotFound } from "./errors.ts";

/** §15.2 quality gates, seeded per task type. */
export const DEFAULT_CRITERIA: Readonly<Record<string, readonly string[]>> = {
  document: ["requirement_coverage", "facts_vs_assumptions", "citations_present", "sensitive_info_absent"],
  code: ["requirement_coverage", "code_validity", "error_handling", "sensitive_info_absent"],
  image: ["requirement_coverage", "visual_direction_match", "sensitive_info_absent"],
  analysis: ["requirement_coverage", "facts_vs_assumptions", "citations_present"],
};

export function criteriaForTaskType(taskType: string): readonly string[] {
  return DEFAULT_CRITERIA[taskType] ?? DEFAULT_CRITERIA["document"] ?? [];
}

export interface CriterionInput {
  criterionKey: string;
  passed: boolean;
  /** Must quote the deliverable. An unevidenced failure is not actionable. */
  evidence: string;
  severity: Severity;
}

/**
 * BLOCKER -> a human decides. MAJOR -> one automatic revision. Otherwise pass.
 * Only failing criteria contribute; severity on a passing criterion is noise.
 */
export function aggregateVerdict(criteria: readonly CriterionInput[]): ReviewVerdict {
  const failures = criteria.filter((c) => !c.passed);
  if (failures.some((c) => c.severity === "BLOCKER")) return "USER_DECISION";
  if (failures.some((c) => c.severity === "MAJOR")) return "REVISION";
  return "PASS";
}

export interface RecordReviewInput {
  taskId: string;
  reviewerRunId: string;
  contextPackageId?: string | null;
  round: number;
  criteria: readonly CriterionInput[];
  /** Self-reported by the model. Stored for calibration analysis only. */
  confidence?: number | null;
  /** §16 safety-refusal row. Overrides checklist aggregation. */
  safetyRefusal?: { reason: string } | null;
}

export function recordReview(tx: Tx, input: RecordReviewInput, clock: Clock): ReviewRow {
  const task = tx.getTask(input.taskId);
  if (!task) throw new NotFound("Task", input.taskId);

  const verdict: ReviewVerdict = input.safetyRefusal ? "BLOCKED_SAFETY" : aggregateVerdict(input.criteria);
  const now = clock.now();

  const review: ReviewRow = {
    id: tx.nextId("rev"),
    taskId: input.taskId,
    reviewerRunId: input.reviewerRunId,
    contextPackageId: input.contextPackageId ?? null,
    round: input.round,
    verdict,
    // Deliberately never consulted when computing `verdict` above: self-reported
    // confidence is not comparable across providers, so gating a state transition on
    // it would make behaviour depend on which vendor happened to be assigned.
    confidence: input.confidence ?? null,
    createdAt: now,
  };
  tx.insertReview(review);

  for (const criterion of input.criteria) {
    const row: CriterionResultRow = {
      id: tx.nextId("crt"),
      reviewId: review.id,
      criterionKey: criterion.criterionKey,
      passed: criterion.passed,
      evidence: criterion.evidence,
      severity: criterion.severity,
    };
    tx.insertCriterionResult(row);
  }

  tx.insertAudit({
    id: tx.nextId("aud"),
    projectId: task.projectId,
    taskId: input.taskId,
    runId: input.reviewerRunId,
    eventType: "REVIEW_RECORDED",
    actorId: null,
    payload: {
      reviewId: review.id,
      verdict,
      round: input.round,
      failedCriteria: input.criteria.filter((c) => !c.passed).map((c) => c.criterionKey),
      safetyRefusalReason: input.safetyRefusal?.reason ?? null,
    },
    createdAt: now,
  });

  return review;
}

/**
 * Maps a verdict onto the next task state, honouring the §7.1 default of exactly one
 * automatic revision. Once the revision allowance is used up a second REVISION
 * becomes a user decision rather than an unbounded loop.
 */
export function nextStateForVerdict(
  verdict: ReviewVerdict,
  round: number,
  maxRounds: number,
): "APPROVED" | "REVISION" | "USER_DECISION" {
  if (verdict === "PASS") return "APPROVED";
  if (verdict === "BLOCKED_SAFETY") return "USER_DECISION";
  if (verdict === "USER_DECISION") return "USER_DECISION";
  return round < maxRounds ? "REVISION" : "USER_DECISION";
}
