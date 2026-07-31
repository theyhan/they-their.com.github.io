// Storage port. Core logic depends only on this, so the Prisma implementation can
// drop in behind it without touching a single business rule.
//
// Transactions are synchronous on purpose: every invariant in D1-D4 (reserve then
// insert, transition plus audit, conditional lease upsert) must be atomic, and a
// synchronous callback makes it impossible to accidentally await something
// non-transactional in the middle of one.

import type {
  ArtifactPatchRow,
  ArtifactRow,
  ArtifactVersionRow,
  AssignmentDecisionRow,
  AuditRow,
  ContextPackageRow,
  CriterionResultRow,
  IdempotencyRow,
  LeaseRow,
  LedgerRow,
  ModelConfigRow,
  ProjectRow,
  ReviewRow,
  RunRow,
  RunStats,
  TaskRow,
} from "../domain/rows.ts";

export interface Tx {
  getProject(id: string): ProjectRow | undefined;
  updateProject(id: string, patch: Partial<ProjectRow>): void;

  getTask(id: string): TaskRow | undefined;
  updateTask(id: string, patch: Partial<TaskRow>): void;
  tasksForProject(projectId: string): TaskRow[];

  getModelConfig(id: string): ModelConfigRow | undefined;

  insertRun(row: RunRow): void;
  getRun(id: string): RunRow | undefined;
  updateRun(id: string, patch: Partial<RunRow>): void;
  /** D2: enforces UNIQUE(taskId, idempotencyKey). */
  findRunByIdempotency(taskId: string, idempotencyKey: string): RunRow | undefined;
  runsByStatus(status: RunRow["status"]): RunRow[];

  insertLedger(row: LedgerRow): void;
  ledgerForProject(projectId: string): LedgerRow[];
  ledgerForRun(runId: string): LedgerRow[];

  insertAudit(row: AuditRow): void;
  auditForProject(projectId: string): AuditRow[];

  getLease(artifactId: string): LeaseRow | undefined;
  putLease(row: LeaseRow): void;
  deleteLease(artifactId: string): void;
  allLeases(): LeaseRow[];

  getArtifact(id: string): ArtifactRow | undefined;
  insertArtifact(row: ArtifactRow): void;
  updateArtifact(id: string, patch: Partial<ArtifactRow>): void;
  insertArtifactVersion(row: ArtifactVersionRow): void;
  versionsForArtifact(artifactId: string): ArtifactVersionRow[];
  insertArtifactPatch(row: ArtifactPatchRow): void;
  patchesForArtifact(artifactId: string): ArtifactPatchRow[];

  insertReview(row: ReviewRow): void;
  insertCriterionResult(row: CriterionResultRow): void;
  reviewsForTask(taskId: string): ReviewRow[];

  insertAssignmentDecision(row: AssignmentDecisionRow): void;
  assignmentDecisionsForTask(taskId: string): AssignmentDecisionRow[];

  insertContextPackage(row: ContextPackageRow): void;
  getContextPackage(id: string): ContextPackageRow | undefined;

  getIdempotency(scope: string, key: string): IdempotencyRow | undefined;
  putIdempotency(row: IdempotencyRow): void;
  deleteIdempotency(scope: string, key: string): void;

  /** D5: historical quality and latency inputs for the assignment score. */
  runStats(modelConfigId: string, capabilityTag: string): RunStats;

  nextId(prefix: string): string;
}

export interface Store {
  /** Commits if fn returns, discards all writes if it throws. */
  transaction<T>(fn: (tx: Tx) => T): T;
}
