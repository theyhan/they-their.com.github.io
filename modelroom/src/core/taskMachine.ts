// Spec v1.1 D3: the single path through which task status may change.
//
// Two invariants are enforced structurally rather than by convention:
//   1. No transition without an AuditEvent in the same transaction. That is what
//      makes §19 traceability a property of the system instead of a promise.
//   2. Leaving a lease-holding state releases the artifact lease. This is the entire
//      reason Halted is distinct from Cancelled: a task parked awaiting a user
//      decision for 72 hours must not keep an artifact locked.

import type { TaskRow } from "../domain/rows.ts";
import { isLegalTransition, releasesLease, type TaskStatus } from "../domain/states.ts";
import type { Clock } from "../ports/clock.ts";
import type { Tx } from "../ports/store.ts";
import { ConcurrentTransition, IllegalTransition, NotFound } from "./errors.ts";
import { releaseLease } from "./lease.ts";

/** Default window before an unanswered user decision parks the task (D3). */
export const DECISION_DEADLINE_MS = 72 * 60 * 60 * 1000;

export interface TransitionInput {
  taskId: string;
  /** Accepted current states. Guards against acting on a stale read. */
  from: readonly TaskStatus[];
  to: TaskStatus;
  cause: string;
  actorId?: string | null;
  expectedVersion?: number | undefined;
  haltReason?: string | null;
  payload?: Record<string, unknown>;
}

export function transition(tx: Tx, input: TransitionInput, clock: Clock): TaskRow {
  const task = tx.getTask(input.taskId);
  if (!task) throw new NotFound("Task", input.taskId);

  if (input.expectedVersion !== undefined && task.version !== input.expectedVersion) {
    throw new ConcurrentTransition(input.taskId);
  }
  if (!input.from.includes(task.status)) {
    throw new ConcurrentTransition(input.taskId);
  }
  if (!isLegalTransition(task.status, input.to)) {
    throw new IllegalTransition(input.taskId, task.status, input.to);
  }

  const now = clock.now();
  const patch: Partial<TaskRow> = {
    status: input.to,
    version: task.version + 1,
  };

  if (input.to === "USER_DECISION") {
    patch.decisionDeadlineAt = now + DECISION_DEADLINE_MS;
  } else {
    patch.decisionDeadlineAt = null;
  }

  if (input.to === "HALTED") patch.haltReason = input.haltReason ?? input.cause;
  else patch.haltReason = null;

  tx.updateTask(task.id, patch);

  const releasedArtifacts = releasesLease(input.to) ? releaseLeasesForTask(tx, task.id, clock) : [];

  tx.insertAudit({
    id: tx.nextId("aud"),
    projectId: task.projectId,
    taskId: task.id,
    runId: null,
    eventType: "TASK_TRANSITION",
    actorId: input.actorId ?? null,
    payload: {
      from: task.status,
      to: input.to,
      cause: input.cause,
      releasedArtifacts,
      ...(input.payload ?? {}),
    },
    createdAt: now,
  });

  const updated = tx.getTask(task.id);
  if (!updated) throw new NotFound("Task", task.id);
  return updated;
}

function releaseLeasesForTask(tx: Tx, taskId: string, clock: Clock): string[] {
  const released: string[] = [];
  for (const lease of tx.allLeases()) {
    const holder = tx.getRun(lease.holderRunId);
    if (holder?.taskId !== taskId) continue;
    releaseLease(tx, lease.artifactId, clock, "TASK_LEFT_LEASE_HOLDING_STATE");
    released.push(lease.artifactId);
  }
  return released;
}

/**
 * D3: an expired decision deadline parks the task in Halted. It deliberately does
 * NOT auto-select an option; silently adopting a model's answer would corrupt the
 * §19 decision history that the product promises users can audit.
 */
export function expireStaleDecisions(tx: Tx, projectId: string, clock: Clock): string[] {
  const now = clock.now();
  const expired: string[] = [];

  for (const task of tx.tasksForProject(projectId)) {
    if (task.status !== "USER_DECISION") continue;
    if (task.decisionDeadlineAt === null || task.decisionDeadlineAt > now) continue;

    transition(
      tx,
      {
        taskId: task.id,
        from: ["USER_DECISION"],
        to: "HALTED",
        cause: "DECISION_DEADLINE_EXPIRED",
        haltReason: "DECISION_DEADLINE_EXPIRED",
        payload: { deadlineAt: task.decisionDeadlineAt },
      },
      clock,
    );
    expired.push(task.id);
  }

  return expired;
}
