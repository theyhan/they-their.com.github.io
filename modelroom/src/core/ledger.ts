// Spec v1.1 D1: two-phase cost accounting.
//
// The whole point: §15.1 demands a hard stop at 100% of budget, but a provider only
// reports usage AFTER a run finishes. So a run may not start until its worst case is
// reserved, and its output cap is derived from the REMAINING budget rather than from
// a static config value.

import { computeCost, type Micros } from "../domain/money.ts";
import type { LedgerRow, ProjectRow, RunRow } from "../domain/rows.ts";
import type { Tx } from "../ports/store.ts";
import type { Clock } from "../ports/clock.ts";
import { BudgetExhausted, InvariantViolation, NotFound } from "./errors.ts";

/**
 * Below this an output is not worth generating, so refusing admission is cheaper
 * than producing a truncated deliverable the user will discard.
 */
export const MIN_OUTPUT_TOKENS = 512;

const ALERT_THRESHOLDS: ReadonlyArray<{ pct: bigint; bit: number }> = [
  { pct: 70n, bit: 1 },
  { pct: 90n, bit: 2 },
  { pct: 100n, bit: 4 },
];

export interface AdmitInput {
  runId: string;
  projectId: string;
  modelConfigId: string;
  estimatedInputTokens: number;
  requestedMaxOutputTokens: number;
}

export interface TokenCap {
  /** The cap the run MUST enforce, both provider-side and worker-side. */
  maxOutputTokens: number;
  holdMicros: Micros;
  estimatedInputTokens: number;
}

export type SettleOutcome = "COMPLETED" | "FAILED" | "CANCELLED" | "UNKNOWN";

export interface SettleInput {
  runId: string;
  outcome: SettleOutcome;
  inputTokens: number;
  outputTokens: number;
  errorCode?: string | null;
}

export interface SettleResult {
  settledMicros: Micros;
  releasedMicros: Micros;
  /** > 0 when the provider billed beyond what we reserved. Always audited. */
  overshotMicros: Micros;
  alreadySettled: boolean;
}

/**
 * available = budgetLimit - Σ SETTLE - Σ (HOLD of runs with no terminal entry)
 *
 * A hold stays "open" until a SETTLE or RELEASE names its run, so reserved money is
 * unavailable to concurrent runs. This is what makes the guard hold under
 * parallelism rather than only in a sequential test.
 */
export function availableMicros(tx: Tx, projectId: string): Micros {
  const project = requireProject(tx, projectId);
  const rows = tx.ledgerForProject(projectId);

  let settled = 0n;
  const holdByRun = new Map<string, Micros>();
  const closedRuns = new Set<string>();

  for (const row of rows) {
    if (row.type === "SETTLE") {
      settled += row.amountMicros;
      if (row.runId) closedRuns.add(row.runId);
    } else if (row.type === "RELEASE") {
      if (row.runId) closedRuns.add(row.runId);
    } else if (row.type === "HOLD" && row.runId) {
      holdByRun.set(row.runId, (holdByRun.get(row.runId) ?? 0n) + row.amountMicros);
    }
  }

  let openHolds = 0n;
  for (const [runId, amount] of holdByRun) {
    if (!closedRuns.has(runId)) openHolds += amount;
  }

  return project.budgetLimitMicros - settled - openHolds;
}

/** Reserved money counts as spent for alerting purposes (D1). */
export function spentIncludingHolds(tx: Tx, projectId: string): Micros {
  const project = requireProject(tx, projectId);
  return project.budgetLimitMicros - availableMicros(tx, projectId);
}

/**
 * Reserve worst-case cost and return the enforced output cap.
 * Throws BudgetExhausted BEFORE any Run row or provider call exists.
 */
export function admit(tx: Tx, input: AdmitInput, clock: Clock): TokenCap {
  const config = tx.getModelConfig(input.modelConfigId);
  if (!config) throw new NotFound("ModelConfig", input.modelConfigId);

  const fixedCost = BigInt(input.estimatedInputTokens) * config.inputPriceMicrosPerToken;
  const perOutputToken = config.outputPriceMicrosPerToken;
  const available = availableMicros(tx, input.projectId);
  const floor = fixedCost + BigInt(MIN_OUTPUT_TOKENS) * perOutputToken;

  if (available <= floor) {
    haltProjectForBudget(tx, input.projectId, clock, {
      reason: "ADMISSION_REFUSED",
      availableMicros: available.toString(),
      requiredMicros: floor.toString(),
    });
    throw new BudgetExhausted(available, floor);
  }

  const maxOutputTokens = affordableOutputTokens(
    available - fixedCost,
    perOutputToken,
    Math.min(config.maxOutputTokens, input.requestedMaxOutputTokens),
  );

  const holdMicros = fixedCost + BigInt(maxOutputTokens) * perOutputToken;

  tx.insertLedger({
    id: tx.nextId("led"),
    projectId: input.projectId,
    runId: input.runId,
    type: "HOLD",
    amountMicros: holdMicros,
    note: `admit maxOut=${maxOutputTokens}`,
    createdAt: clock.now(),
  });

  fireBudgetAlerts(tx, input.projectId, clock);

  return { maxOutputTokens, holdMicros, estimatedInputTokens: input.estimatedInputTokens };
}

function affordableOutputTokens(remainingAfterInput: Micros, perToken: Micros, ceiling: number): number {
  if (perToken <= 0n) return ceiling;
  const affordable = remainingAfterInput / perToken;
  // Compare in bigint first: an enormous affordable count must not round-trip
  // through Number and lose precision.
  return affordable > BigInt(ceiling) ? ceiling : Number(affordable);
}

/**
 * Finalize a run's money. Idempotent by runId: calling it twice is a no-op, which is
 * required because both the streaming worker and the reconciliation sweeper (D2) may
 * race to settle the same run.
 */
export function settle(tx: Tx, input: SettleInput, clock: Clock): SettleResult {
  const run = tx.getRun(input.runId);
  if (!run) throw new NotFound("Run", input.runId);

  const rows = tx.ledgerForRun(input.runId);
  const priorTerminal = rows.filter((r) => r.type === "SETTLE" || r.type === "RELEASE");
  if (priorTerminal.length > 0) {
    return {
      settledMicros: sum(rows.filter((r) => r.type === "SETTLE")),
      releasedMicros: sum(rows.filter((r) => r.type === "RELEASE")),
      overshotMicros: 0n,
      alreadySettled: true,
    };
  }

  const holdMicros = sum(rows.filter((r) => r.type === "HOLD"));
  if (holdMicros <= 0n) {
    // Settling a run that never reserved means admit() was bypassed. That is a
    // programming error, not a runtime condition: fail loudly.
    throw new InvariantViolation(`Run ${input.runId} has no reservation to settle`);
  }

  const config = tx.getModelConfig(run.modelConfigId);
  if (!config) throw new NotFound("ModelConfig", run.modelConfigId);

  const actualMicros =
    input.outcome === "UNKNOWN"
      ? // D1: the provider may already have charged us. Releasing an unknown hold is
        // how a budget silently leaks, so assume the worst case.
        holdMicros
      : computeCost(
          input.inputTokens,
          input.outputTokens,
          config.inputPriceMicrosPerToken,
          config.outputPriceMicrosPerToken,
        );

  const now = clock.now();
  let settledMicros = 0n;
  let releasedMicros = 0n;
  let overshotMicros = 0n;

  if (actualMicros <= 0n) {
    releasedMicros = holdMicros;
    tx.insertLedger(ledgerRow(tx, run, "RELEASE", holdMicros, `${input.outcome}: no usage reported`, now));
  } else {
    settledMicros = actualMicros;
    tx.insertLedger(ledgerRow(tx, run, "SETTLE", actualMicros, `${input.outcome}`, now));

    const remainder = holdMicros - actualMicros;
    if (remainder > 0n) {
      releasedMicros = remainder;
      tx.insertLedger(ledgerRow(tx, run, "RELEASE", remainder, "unused reservation", now));
    } else if (remainder < 0n) {
      overshotMicros = -remainder;
      tx.insertAudit({
        id: tx.nextId("aud"),
        projectId: run.projectId,
        taskId: run.taskId,
        runId: run.id,
        eventType: "BUDGET_OVERSHOOT",
        actorId: null,
        payload: {
          holdMicros: holdMicros.toString(),
          actualMicros: actualMicros.toString(),
          overshotMicros: overshotMicros.toString(),
          outputTokens: input.outputTokens,
          maxOutputTokens: run.maxOutputTokens,
        },
        createdAt: now,
      });
    }
  }

  tx.updateRun(run.id, {
    status: input.outcome === "UNKNOWN" ? "UNKNOWN" : input.outcome,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    costMicros: settledMicros,
    errorCode: input.errorCode ?? null,
    endedAt: now,
  });

  fireBudgetAlerts(tx, run.projectId, clock);
  if (availableMicros(tx, run.projectId) <= 0n) {
    haltProjectForBudget(tx, run.projectId, clock, { reason: "SETTLED_TO_ZERO" });
  }

  return { settledMicros, releasedMicros, overshotMicros, alreadySettled: false };
}

/** Each threshold fires at most once per project, so alerts cannot spam per run. */
export function fireBudgetAlerts(tx: Tx, projectId: string, clock: Clock): number[] {
  const project = requireProject(tx, projectId);
  if (project.budgetLimitMicros <= 0n) return [];

  const spent = spentIncludingHolds(tx, projectId);
  const pct = (spent * 100n) / project.budgetLimitMicros;

  const fired: number[] = [];
  let mask = project.alertsFired;

  for (const threshold of ALERT_THRESHOLDS) {
    if (pct >= threshold.pct && (mask & threshold.bit) === 0) {
      mask |= threshold.bit;
      fired.push(Number(threshold.pct));
      tx.insertAudit({
        id: tx.nextId("aud"),
        projectId,
        taskId: null,
        runId: null,
        eventType: "BUDGET_ALERT",
        actorId: null,
        payload: {
          thresholdPct: Number(threshold.pct),
          spentMicros: spent.toString(),
          limitMicros: project.budgetLimitMicros.toString(),
        },
        createdAt: clock.now(),
      });
    }
  }

  if (mask !== project.alertsFired) tx.updateProject(projectId, { alertsFired: mask });
  return fired;
}

export function haltProjectForBudget(
  tx: Tx,
  projectId: string,
  clock: Clock,
  payload: Record<string, unknown>,
): void {
  const project = requireProject(tx, projectId);
  if (project.status === "HALTED_BUDGET") return;

  tx.updateProject(projectId, { status: "HALTED_BUDGET" });
  tx.insertAudit({
    id: tx.nextId("aud"),
    projectId,
    taskId: null,
    runId: null,
    eventType: "PROJECT_HALTED_BUDGET",
    actorId: null,
    payload,
    createdAt: clock.now(),
  });
}

function ledgerRow(
  tx: Tx,
  run: RunRow,
  type: LedgerRow["type"],
  amountMicros: Micros,
  note: string,
  createdAt: number,
): LedgerRow {
  return {
    id: tx.nextId("led"),
    projectId: run.projectId,
    runId: run.id,
    type,
    amountMicros,
    note,
    createdAt,
  };
}

function sum(rows: LedgerRow[]): Micros {
  return rows.reduce((total, row) => total + row.amountMicros, 0n);
}

function requireProject(tx: Tx, projectId: string): ProjectRow {
  const project = tx.getProject(projectId);
  if (!project) throw new NotFound("Project", projectId);
  return project;
}
