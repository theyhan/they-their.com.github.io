// Spec v1.1 D5: transparent, rule-based assignment.
//
// v1.0 §6.3 weights "Historical Quality 20%" but the MVP launches with zero history,
// leaving the formula undefined on day one. Fixed by shrinking observed approval
// rates toward a configured prior, so the score is total-ordered from the very first
// request and converges to real data without a discontinuity.

import type { Micros } from "../domain/money.ts";
import type { AssignmentDecisionRow, FactorBreakdown } from "../domain/rows.ts";
import type { Clock } from "../ports/clock.ts";
import type { Tx } from "../ports/store.ts";
import { NotFound } from "./errors.ts";

export const WEIGHTS = {
  capability: 0.45,
  quality: 0.2,
  cost: 0.15,
  latency: 0.1,
  preference: 0.1,
} as const;

/** Pseudo-count for Bayesian shrinkage: at n=0 quality equals the prior exactly. */
export const QUALITY_PSEUDO_COUNT = 10;

/** Below this score gap the engine does not trust itself, so it forces review. */
export const FORCED_REVIEW_MARGIN = 0.08;

/** Tags that always get cross-reviewed regardless of confidence (§6.1 step 5). */
export const HIGH_RISK_TAGS: readonly string[] = ["fact_check", "final_synthesis", "coding"];

export const NEUTRAL_PRIOR = 0.5;

export interface Candidate {
  modelConfigId: string;
  estimatedCostMicros: Micros;
}

export interface ScoreInput {
  capabilityTags: string[];
  candidates: Candidate[];
  /** User-pinned model, if any (§6.1 step 6 override). */
  pinnedModelConfigId?: string | null;
}

export interface AssignmentResult {
  chosenModelId: string;
  runnerUpModelId: string | null;
  /** The opposing model, set when cross-review is required. */
  reviewerModelId: string | null;
  totalScore: number;
  scoreMargin: number;
  forcedReview: boolean;
  forcedReviewReason: string | null;
  breakdown: Record<string, FactorBreakdown>;
}

export function scoreAssignment(tx: Tx, input: ScoreInput): AssignmentResult {
  if (input.candidates.length === 0) {
    throw new NotFound("ModelConfig", "<no candidates>");
  }

  const maxCost = input.candidates.reduce((m, c) => (c.estimatedCostMicros > m ? c.estimatedCostMicros : m), 0n);
  const latencies = new Map<string, number>();
  for (const candidate of input.candidates) {
    latencies.set(candidate.modelConfigId, medianLatency(tx, candidate.modelConfigId, input.capabilityTags));
  }
  const maxLatency = Math.max(...latencies.values(), 0);

  const breakdown: Record<string, FactorBreakdown> = {};

  for (const candidate of input.candidates) {
    const config = tx.getModelConfig(candidate.modelConfigId);
    if (!config) throw new NotFound("ModelConfig", candidate.modelConfigId);

    const capability = mean(input.capabilityTags.map((tag) => clamp01(config.capabilities[tag] ?? 0)));
    const quality = mean(input.capabilityTags.map((tag) => shrunkQuality(tx, candidate.modelConfigId, tag, config.capabilityPriors[tag])));
    // Cheaper is better; if every candidate is free the factor is neutralized to 1.
    const cost = maxCost === 0n ? 1 : 1 - ratio(candidate.estimatedCostMicros, maxCost);
    const latency = maxLatency === 0 ? 1 : 1 - (latencies.get(candidate.modelConfigId) ?? 0) / maxLatency;
    const preference =
      input.pinnedModelConfigId == null ? 0.5 : candidate.modelConfigId === input.pinnedModelConfigId ? 1 : 0;

    const total =
      WEIGHTS.capability * capability +
      WEIGHTS.quality * quality +
      WEIGHTS.cost * cost +
      WEIGHTS.latency * latency +
      WEIGHTS.preference * preference;

    breakdown[candidate.modelConfigId] = {
      capability: round6(capability),
      quality: round6(quality),
      cost: round6(cost),
      latency: round6(latency),
      preference: round6(preference),
      total: round6(total),
    };
  }

  // Deterministic ordering: score desc, then id asc. Without the tiebreak, two
  // equally-scored models would be chosen by object key order, and the "identical
  // candidates" case is exactly what happens on a fresh install.
  const ranked = input.candidates
    .map((c) => ({ id: c.modelConfigId, total: breakdown[c.modelConfigId]?.total ?? 0 }))
    .sort((a, b) => (b.total - a.total) || a.id.localeCompare(b.id));

  const winner = ranked[0];
  if (!winner) throw new NotFound("ModelConfig", "<no candidates>");
  const runnerUp = ranked[1] ?? null;
  const scoreMargin = runnerUp ? round6(winner.total - runnerUp.total) : 1;

  const highRiskTag = input.capabilityTags.find((tag) => HIGH_RISK_TAGS.includes(tag));
  const lowConfidence = runnerUp !== null && scoreMargin < FORCED_REVIEW_MARGIN;
  const forcedReview = lowConfidence || highRiskTag !== undefined;

  return {
    chosenModelId: winner.id,
    runnerUpModelId: runnerUp?.id ?? null,
    reviewerModelId: forcedReview ? (runnerUp?.id ?? null) : null,
    totalScore: winner.total,
    scoreMargin,
    forcedReview,
    forcedReviewReason: lowConfidence
      ? "LOW_CONFIDENCE_MARGIN"
      : highRiskTag !== undefined
        ? `HIGH_RISK_TAG:${highRiskTag}`
        : null,
    breakdown,
  };
}

/**
 * quality = (approvals + m * prior) / (n + m)
 *
 * "approvals" counts only tasks whose first review PASSed AND which the user did not
 * later revise. Bare approval is too weak a signal: users approve mediocre output to
 * keep moving, and that would teach the engine the wrong lesson.
 */
export function shrunkQuality(tx: Tx, modelConfigId: string, tag: string, prior: number | undefined): number {
  const p = clamp01(prior ?? NEUTRAL_PRIOR);
  const stats = tx.runStats(modelConfigId, tag);
  const m = QUALITY_PSEUDO_COUNT;
  return clamp01((stats.approvals + m * p) / (stats.n + m));
}

/**
 * Persists the engine's proposal and applies it to the task.
 *
 * The AssignmentDecision row is not optional: §20's "automatic assignment retention
 * rate" KPI is uncomputable unless we retain what the engine originally proposed
 * alongside what the user changed it to.
 */
export function recordAssignment(
  tx: Tx,
  taskId: string,
  result: AssignmentResult,
  clock: Clock,
): AssignmentDecisionRow {
  const task = tx.getTask(taskId);
  if (!task) throw new NotFound("Task", taskId);

  const row: AssignmentDecisionRow = {
    id: tx.nextId("asg"),
    taskId,
    chosenModelId: result.chosenModelId,
    runnerUpModelId: result.runnerUpModelId,
    totalScore: result.totalScore,
    breakdown: result.breakdown,
    scoreMargin: result.scoreMargin,
    forcedReview: result.forcedReview,
    overriddenByUser: false,
    createdAt: clock.now(),
  };
  tx.insertAssignmentDecision(row);

  tx.updateTask(taskId, {
    assigneeModelId: result.chosenModelId,
    reviewerModelId: result.reviewerModelId,
  });

  tx.insertAudit({
    id: tx.nextId("aud"),
    projectId: task.projectId,
    taskId,
    runId: null,
    eventType: "ASSIGNMENT_PROPOSED",
    actorId: null,
    payload: {
      chosenModelId: result.chosenModelId,
      reviewerModelId: result.reviewerModelId,
      scoreMargin: result.scoreMargin,
      forcedReview: result.forcedReview,
      forcedReviewReason: result.forcedReviewReason,
      breakdown: result.breakdown,
    },
    createdAt: clock.now(),
  });

  return row;
}

/** §12 PATCH /tasks/:id/assignment. Flags the override for the retention KPI. */
export function overrideAssignment(
  tx: Tx,
  taskId: string,
  patch: { assigneeModelId?: string; reviewerModelId?: string | null },
  actorId: string,
  clock: Clock,
): void {
  const task = tx.getTask(taskId);
  if (!task) throw new NotFound("Task", taskId);

  const update: { assigneeModelId?: string; reviewerModelId?: string | null } = {};
  if (patch.assigneeModelId !== undefined) update.assigneeModelId = patch.assigneeModelId;
  if (patch.reviewerModelId !== undefined) update.reviewerModelId = patch.reviewerModelId;
  tx.updateTask(taskId, update);

  const decisions = tx.assignmentDecisionsForTask(taskId);
  const latest = decisions[decisions.length - 1];
  if (latest && patch.assigneeModelId !== undefined && patch.assigneeModelId !== latest.chosenModelId) {
    latest.overriddenByUser = true;
  }

  tx.insertAudit({
    id: tx.nextId("aud"),
    projectId: task.projectId,
    taskId,
    runId: null,
    eventType: "ASSIGNMENT_OVERRIDDEN",
    actorId,
    payload: {
      previousAssignee: task.assigneeModelId,
      previousReviewer: task.reviewerModelId,
      ...patch,
    },
    createdAt: clock.now(),
  });
}

function medianLatency(tx: Tx, modelConfigId: string, tags: string[]): number {
  const samples = tags.map((tag) => tx.runStats(modelConfigId, tag).p50Ms).filter((v) => v > 0);
  return samples.length === 0 ? 0 : mean(samples);
}

function ratio(numerator: Micros, denominator: Micros): number {
  if (denominator === 0n) return 0;
  // Scale before dividing so integer division does not collapse to 0.
  return Number((numerator * 1_000_000n) / denominator) / 1_000_000;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
