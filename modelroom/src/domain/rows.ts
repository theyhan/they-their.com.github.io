// Row shapes mirroring docs/modelroom/schema.prisma. Timestamps are epoch
// milliseconds so the Clock port can make every test deterministic.

import type { Micros } from "./money.ts";
import type {
  ArtifactType,
  LedgerType,
  Provider,
  ProjectStatus,
  ReviewVerdict,
  RunStatus,
  Severity,
  TaskStatus,
} from "./states.ts";

export interface ProjectRow {
  id: string;
  workspaceId: string;
  goal: string;
  mode: string;
  status: ProjectStatus;
  budgetLimitMicros: Micros;
  /** Bitmask: 1 = 70%, 2 = 90%, 4 = 100%. Ensures each alert fires once. */
  alertsFired: number;
  maxDebateRounds: number;
}

export interface TaskRow {
  id: string;
  projectId: string;
  title: string;
  type: string;
  capabilityTags: string[];
  assigneeModelId: string | null;
  reviewerModelId: string | null;
  status: TaskStatus;
  priority: number;
  round: number;
  /** Optimistic concurrency for the single transition() path (D3). */
  version: number;
  decisionDeadlineAt: number | null;
  haltReason: string | null;
}

export interface ModelConfigRow {
  id: string;
  provider: Provider;
  modelId: string;
  displayName: string;
  enabled: boolean;
  inputPriceMicrosPerToken: Micros;
  outputPriceMicrosPerToken: Micros;
  contextLimitTokens: number;
  maxOutputTokens: number;
  capabilities: Record<string, number>;
  capabilityPriors: Record<string, number>;
}

export interface RunRow {
  id: string;
  taskId: string;
  projectId: string;
  modelConfigId: string;
  contextPackageId: string | null;
  status: RunStatus;
  idempotencyKey: string;
  attemptGroupId: string;
  providerRequestId: string | null;
  inputTokens: number;
  outputTokens: number;
  maxOutputTokens: number;
  costMicros: Micros;
  errorCode: string | null;
  startedAt: number;
  endedAt: number | null;
}

export interface LedgerRow {
  id: string;
  projectId: string;
  runId: string | null;
  type: LedgerType;
  amountMicros: Micros;
  note: string | null;
  createdAt: number;
}

export interface AuditRow {
  id: string;
  projectId: string;
  taskId: string | null;
  runId: string | null;
  eventType: string;
  actorId: string | null;
  /** Never contains API keys, tokens, or PII (§15.3). */
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface LeaseRow {
  artifactId: string;
  holderRunId: string;
  /** Fencing token. Monotonic per artifact. */
  epoch: number;
  acquiredAt: number;
  heartbeatAt: number;
  expiresAt: number;
}

export interface ArtifactRow {
  id: string;
  projectId: string;
  taskId: string | null;
  type: ArtifactType;
  name: string;
  headVersion: number;
  activeWriterRunId: string | null;
}

export interface ArtifactVersionRow {
  id: string;
  artifactId: string;
  version: number;
  baseVersion: number;
  uri: string;
  sizeBytes: number;
  createdByRunId: string | null;
  epoch: number;
  createdAt: number;
}

export interface ArtifactPatchRow {
  id: string;
  artifactId: string;
  baseVersion: number;
  diff: string;
  rationale: string | null;
  proposedByRunId: string;
  status: "PROPOSED" | "APPLIED" | "REJECTED" | "STALE";
  createdAt: number;
}

export interface ReviewRow {
  id: string;
  taskId: string;
  reviewerRunId: string;
  contextPackageId: string | null;
  round: number;
  verdict: ReviewVerdict;
  /** Self-reported. Advisory only: must never gate a transition (D6). */
  confidence: number | null;
  createdAt: number;
}

export interface CriterionResultRow {
  id: string;
  reviewId: string;
  criterionKey: string;
  passed: boolean;
  evidence: string;
  severity: Severity;
}

export interface AssignmentDecisionRow {
  id: string;
  taskId: string;
  chosenModelId: string;
  runnerUpModelId: string | null;
  totalScore: number;
  breakdown: Record<string, FactorBreakdown>;
  scoreMargin: number;
  forcedReview: boolean;
  overriddenByUser: boolean;
  createdAt: number;
}

export interface FactorBreakdown {
  capability: number;
  quality: number;
  cost: number;
  latency: number;
  preference: number;
  total: number;
}

export interface ContextPackageRow {
  id: string;
  taskId: string;
  round: number;
  targetProvider: Provider;
  payload: ContextPackagePayload;
  tokenEstimate: number;
  contentHash: string;
  sourceRefs: SourceRefs;
  createdAt: number;
}

/** §13: what the reviewing model receives instead of the whole conversation. */
export interface ContextPackagePayload {
  projectGoal: string;
  task: { id: string; title: string; completionCriteria: string[] };
  decisions: Array<{ id: string; selectedOption: string; rationale: string | null }>;
  counterpartDeliverable: string | null;
  files: Array<{ id: string; name: string; content: string; summarized: boolean }>;
  reviewCriteria: string[];
  remainingRounds: number;
  remainingBudgetMicros: string;
}

export interface SourceRefs {
  artifactVersionIds: string[];
  decisionIds: string[];
  reviewIds: string[];
  fileIds: string[];
}

export interface IdempotencyRow {
  scope: string;
  key: string;
  requestHash: string;
  projectId: string | null;
  responseSnapshot: unknown;
  status: "IN_PROGRESS" | "DONE";
  createdAt: number;
}

export interface RunStats {
  /** Completed runs for this (model, tag) pair. */
  n: number;
  /** Runs whose first review PASSed and which the user did not later revise. */
  approvals: number;
  p50Ms: number;
}
