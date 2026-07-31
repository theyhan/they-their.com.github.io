// In-memory Store with real rollback semantics, standing in for PostgreSQL.
//
// Rollback is genuine (the draft is discarded on throw) rather than simulated,
// because the D1 and D4 invariants are precisely about what survives a failed
// transaction. A fake that always commits would make those tests meaningless.

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
import type { Store, Tx } from "../ports/store.ts";

export interface Db {
  projects: Record<string, ProjectRow>;
  tasks: Record<string, TaskRow>;
  modelConfigs: Record<string, ModelConfigRow>;
  runs: Record<string, RunRow>;
  ledger: LedgerRow[];
  audit: AuditRow[];
  leases: Record<string, LeaseRow>;
  artifacts: Record<string, ArtifactRow>;
  artifactVersions: ArtifactVersionRow[];
  artifactPatches: ArtifactPatchRow[];
  reviews: ReviewRow[];
  criteriaResults: CriterionResultRow[];
  assignments: AssignmentDecisionRow[];
  contextPackages: Record<string, ContextPackageRow>;
  idempotency: Record<string, IdempotencyRow>;
  /** key: `${modelConfigId}:${capabilityTag}` */
  stats: Record<string, RunStats>;
  seq: number;
}

export function emptyDb(): Db {
  return {
    projects: {},
    tasks: {},
    modelConfigs: {},
    runs: {},
    ledger: [],
    audit: [],
    leases: {},
    artifacts: {},
    artifactVersions: [],
    artifactPatches: [],
    reviews: [],
    criteriaResults: [],
    assignments: [],
    contextPackages: {},
    idempotency: {},
    stats: {},
    seq: 0,
  };
}

class MemoryTx implements Tx {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  getProject(id: string): ProjectRow | undefined {
    return this.db.projects[id];
  }
  updateProject(id: string, patch: Partial<ProjectRow>): void {
    const row = this.db.projects[id];
    if (row) this.db.projects[id] = { ...row, ...patch };
  }

  getTask(id: string): TaskRow | undefined {
    return this.db.tasks[id];
  }
  updateTask(id: string, patch: Partial<TaskRow>): void {
    const row = this.db.tasks[id];
    if (row) this.db.tasks[id] = { ...row, ...patch };
  }
  tasksForProject(projectId: string): TaskRow[] {
    return Object.values(this.db.tasks).filter((t) => t.projectId === projectId);
  }

  getModelConfig(id: string): ModelConfigRow | undefined {
    return this.db.modelConfigs[id];
  }

  insertRun(row: RunRow): void {
    if (this.findRunByIdempotency(row.taskId, row.idempotencyKey)) {
      // Mirrors UNIQUE(taskId, idempotencyKey) from the Prisma schema.
      throw new Error(`duplicate run for task ${row.taskId} key ${row.idempotencyKey}`);
    }
    this.db.runs[row.id] = row;
  }
  getRun(id: string): RunRow | undefined {
    return this.db.runs[id];
  }
  updateRun(id: string, patch: Partial<RunRow>): void {
    const row = this.db.runs[id];
    if (row) this.db.runs[id] = { ...row, ...patch };
  }
  findRunByIdempotency(taskId: string, idempotencyKey: string): RunRow | undefined {
    return Object.values(this.db.runs).find((r) => r.taskId === taskId && r.idempotencyKey === idempotencyKey);
  }
  runsByStatus(status: RunRow["status"]): RunRow[] {
    return Object.values(this.db.runs).filter((r) => r.status === status);
  }

  insertLedger(row: LedgerRow): void {
    this.db.ledger.push(row);
  }
  ledgerForProject(projectId: string): LedgerRow[] {
    return this.db.ledger.filter((r) => r.projectId === projectId);
  }
  ledgerForRun(runId: string): LedgerRow[] {
    return this.db.ledger.filter((r) => r.runId === runId);
  }

  insertAudit(row: AuditRow): void {
    this.db.audit.push(row);
  }
  auditForProject(projectId: string): AuditRow[] {
    return this.db.audit.filter((r) => r.projectId === projectId);
  }

  getLease(artifactId: string): LeaseRow | undefined {
    return this.db.leases[artifactId];
  }
  putLease(row: LeaseRow): void {
    this.db.leases[row.artifactId] = row;
  }
  deleteLease(artifactId: string): void {
    delete this.db.leases[artifactId];
  }
  allLeases(): LeaseRow[] {
    return Object.values(this.db.leases);
  }

  getArtifact(id: string): ArtifactRow | undefined {
    return this.db.artifacts[id];
  }
  insertArtifact(row: ArtifactRow): void {
    this.db.artifacts[row.id] = row;
  }
  updateArtifact(id: string, patch: Partial<ArtifactRow>): void {
    const row = this.db.artifacts[id];
    if (row) this.db.artifacts[id] = { ...row, ...patch };
  }
  insertArtifactVersion(row: ArtifactVersionRow): void {
    this.db.artifactVersions.push(row);
  }
  versionsForArtifact(artifactId: string): ArtifactVersionRow[] {
    return this.db.artifactVersions.filter((v) => v.artifactId === artifactId);
  }
  insertArtifactPatch(row: ArtifactPatchRow): void {
    this.db.artifactPatches.push(row);
  }
  patchesForArtifact(artifactId: string): ArtifactPatchRow[] {
    return this.db.artifactPatches.filter((p) => p.artifactId === artifactId);
  }

  insertReview(row: ReviewRow): void {
    this.db.reviews.push(row);
  }
  insertCriterionResult(row: CriterionResultRow): void {
    this.db.criteriaResults.push(row);
  }
  reviewsForTask(taskId: string): ReviewRow[] {
    return this.db.reviews.filter((r) => r.taskId === taskId);
  }

  insertAssignmentDecision(row: AssignmentDecisionRow): void {
    this.db.assignments.push(row);
  }
  /** Returns live draft rows: callers may mutate them within the transaction. */
  assignmentDecisionsForTask(taskId: string): AssignmentDecisionRow[] {
    return this.db.assignments.filter((r) => r.taskId === taskId);
  }

  insertContextPackage(row: ContextPackageRow): void {
    this.db.contextPackages[row.id] = row;
  }
  getContextPackage(id: string): ContextPackageRow | undefined {
    return this.db.contextPackages[id];
  }

  getIdempotency(scope: string, key: string): IdempotencyRow | undefined {
    return this.db.idempotency[`${scope}\u0000${key}`];
  }
  putIdempotency(row: IdempotencyRow): void {
    this.db.idempotency[`${row.scope}\u0000${row.key}`] = row;
  }
  deleteIdempotency(scope: string, key: string): void {
    delete this.db.idempotency[`${scope}\u0000${key}`];
  }

  runStats(modelConfigId: string, capabilityTag: string): RunStats {
    return this.db.stats[`${modelConfigId}:${capabilityTag}`] ?? { n: 0, approvals: 0, p50Ms: 0 };
  }

  nextId(prefix: string): string {
    this.db.seq += 1;
    return `${prefix}_${this.db.seq}`;
  }
}

export class MemoryStore implements Store {
  db: Db;

  constructor(db: Db = emptyDb()) {
    this.db = db;
  }

  transaction<T>(fn: (tx: Tx) => T): T {
    const draft = structuredClone(this.db);
    const result = fn(new MemoryTx(draft));
    // Only reached when fn returns normally; a throw propagates and `draft` is
    // discarded, so partial writes never become visible.
    this.db = draft;
    return result;
  }
}
