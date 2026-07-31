// Spec v1.1 D3. Declared as const objects rather than TS enums because Node's
// type-stripping loader cannot erase enums (they emit runtime code).

export const TaskStatus = {
  PLANNED: "PLANNED",
  ASSIGNED: "ASSIGNED",
  RUNNING: "RUNNING",
  REVIEW: "REVIEW",
  REVISION: "REVISION",
  USER_DECISION: "USER_DECISION",
  CONFLICT: "CONFLICT",
  HALTED: "HALTED",
  APPROVED: "APPROVED",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const ProjectStatus = {
  DRAFT: "DRAFT",
  PLANNING: "PLANNING",
  PLAN_REVIEW: "PLAN_REVIEW",
  RUNNING: "RUNNING",
  HALTED_BUDGET: "HALTED_BUDGET",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  ARCHIVED: "ARCHIVED",
} as const;
export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus];

export const RunStatus = {
  PENDING: "PENDING",
  STREAMING: "STREAMING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  /** D2: the provider may have billed us. Never auto-retried. */
  UNKNOWN: "UNKNOWN",
} as const;
export type RunStatus = (typeof RunStatus)[keyof typeof RunStatus];

export const LedgerType = {
  HOLD: "HOLD",
  SETTLE: "SETTLE",
  RELEASE: "RELEASE",
} as const;
export type LedgerType = (typeof LedgerType)[keyof typeof LedgerType];

export const ReviewVerdict = {
  PASS: "PASS",
  REVISION: "REVISION",
  USER_DECISION: "USER_DECISION",
  BLOCKED_SAFETY: "BLOCKED_SAFETY",
} as const;
export type ReviewVerdict = (typeof ReviewVerdict)[keyof typeof ReviewVerdict];

export const Severity = {
  INFO: "INFO",
  MINOR: "MINOR",
  MAJOR: "MAJOR",
  BLOCKER: "BLOCKER",
} as const;
export type Severity = (typeof Severity)[keyof typeof Severity];

export const Provider = {
  OPENAI: "OPENAI",
  GOOGLE: "GOOGLE",
} as const;
export type Provider = (typeof Provider)[keyof typeof Provider];

export const ArtifactType = {
  DOCUMENT: "DOCUMENT",
  CODE: "CODE",
  IMAGE: "IMAGE",
  DATA: "DATA",
  SUMMARY: "SUMMARY",
} as const;
export type ArtifactType = (typeof ArtifactType)[keyof typeof ArtifactType];

/**
 * The only legal task transitions. Anything absent here is a bug, not a state.
 * Mirrors the D3 diagram exactly.
 */
export const LEGAL_TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  // Halted is reachable before Running because admission can be refused for budget
  // before any provider call exists. Without this edge the task would stay Assigned
  // and a scheduler would retry it forever against an exhausted budget.
  PLANNED: ["ASSIGNED", "HALTED", "CANCELLED"],
  ASSIGNED: ["RUNNING", "HALTED", "CANCELLED"],
  RUNNING: ["REVIEW", "FAILED", "CONFLICT", "HALTED", "CANCELLED"],
  REVIEW: ["REVISION", "USER_DECISION", "APPROVED", "HALTED", "CANCELLED"],
  REVISION: ["RUNNING", "HALTED", "CANCELLED"],
  USER_DECISION: ["RUNNING", "APPROVED", "HALTED", "CANCELLED"],
  CONFLICT: ["REVISION", "CANCELLED"],
  HALTED: ["ASSIGNED", "CANCELLED"],
  APPROVED: ["COMPLETED"],
  COMPLETED: [],
  FAILED: ["ASSIGNED", "CANCELLED"],
  CANCELLED: [],
};

export const TERMINAL_TASK_STATES: readonly TaskStatus[] = ["COMPLETED", "CANCELLED"];

/**
 * Only these states may hold an artifact write lease. This is the entire reason
 * Halted exists as a state distinct from Cancelled (D3): a task parked awaiting a
 * user decision must not keep an artifact locked for 72 hours.
 */
export const LEASE_HOLDING_STATES: readonly TaskStatus[] = ["RUNNING", "REVISION"];

export function releasesLease(status: TaskStatus): boolean {
  return !LEASE_HOLDING_STATES.includes(status);
}

export function isLegalTransition(from: TaskStatus, to: TaskStatus): boolean {
  return (LEGAL_TASK_TRANSITIONS[from] ?? []).includes(to);
}

export function isTerminalRunStatus(status: RunStatus): boolean {
  return status === "COMPLETED" || status === "FAILED" || status === "CANCELLED" || status === "UNKNOWN";
}
