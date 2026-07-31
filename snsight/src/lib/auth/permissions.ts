/**
 * Authorisation (FR-001, ADR-0008).
 *
 * The only place a permission decision is made. Callers ask `can(role, capability)`; nothing else
 * compares role strings, because `role === 'ADMIN' || role === 'OWNER'` repeated across a codebase is
 * how a permission gets missed when a fifth role appears.
 *
 * Dependency-free and pure, so the matrix and its invariants are verified by execution.
 */

export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'ANALYST' | 'VIEWER';

export const ROLE_ORDER: readonly WorkspaceRole[] = ['VIEWER', 'ANALYST', 'ADMIN', 'OWNER'];

export type Capability =
  // Workspace administration
  | 'workspace.update'
  | 'workspace.delete'
  | 'billing.manage'
  | 'audit.view'
  // Membership
  | 'member.invite'
  | 'member.remove'
  | 'member.change_role'
  // Platform connections
  | 'account.connect'
  | 'account.disconnect'
  // Analytics work
  | 'dashboard.view'
  | 'analysis.run'
  | 'analysis.feedback'
  | 'classification.correct'
  | 'competitor.manage'
  // Output. Export is bulk egress, so it is separate from viewing (ADR-0008 decision 5).
  | 'report.create'
  | 'report.export'
  | 'report.share';

const VIEWER: readonly Capability[] = ['dashboard.view'];

const ANALYST: readonly Capability[] = [
  ...VIEWER,
  'analysis.run',
  'analysis.feedback',
  'classification.correct',
  'competitor.manage',
  'report.create',
  'report.export',
];

const ADMIN: readonly Capability[] = [
  ...ANALYST,
  'workspace.update',
  'audit.view',
  'member.invite',
  'member.remove',
  'member.change_role',
  'account.connect',
  'account.disconnect',
  'report.share',
];

const OWNER: readonly Capability[] = [...ADMIN, 'workspace.delete', 'billing.manage'];

const MATRIX: Record<WorkspaceRole, readonly Capability[]> = {
  VIEWER,
  ANALYST,
  ADMIN,
  OWNER,
};

/** Frozen sets, so a caller cannot mutate the matrix at runtime. */
const CAPABILITY_SETS: Record<WorkspaceRole, ReadonlySet<Capability>> = {
  VIEWER: new Set(MATRIX.VIEWER),
  ANALYST: new Set(MATRIX.ANALYST),
  ADMIN: new Set(MATRIX.ADMIN),
  OWNER: new Set(MATRIX.OWNER),
};

export function can(role: WorkspaceRole, capability: Capability): boolean {
  return CAPABILITY_SETS[role].has(capability);
}

export function capabilitiesOf(role: WorkspaceRole): readonly Capability[] {
  return MATRIX[role];
}

/**
 * Actions that require authentication within the recent window (ADR-0008 decision 7). A stolen
 * long-lived session should not be able to dismantle a workspace.
 */
const REAUTH_REQUIRED: ReadonlySet<Capability> = new Set<Capability>([
  'workspace.delete',
  'account.disconnect',
  'member.remove',
  'member.change_role',
  'report.share',
  'billing.manage',
]);

export const REAUTH_WINDOW_MINUTES = 15;

export function requiresRecentAuth(capability: Capability): boolean {
  return REAUTH_REQUIRED.has(capability);
}

export interface Member {
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
  /**
   * Social account ids this member may read. Empty means all accounts in the workspace (FR-001).
   * Applies to every role including OWNER, per ADR-0008 decision 6.
   */
  accountScope: readonly string[];
}

export function canAccessAccount(member: Member, socialAccountId: string): boolean {
  if (member.accountScope.length === 0) return true;
  return member.accountScope.includes(socialAccountId);
}

/** Filters a list of accounts to what a member may read. Used by every data query entry point. */
export function visibleAccounts<T extends { id: string }>(member: Member, accounts: readonly T[]): T[] {
  if (member.accountScope.length === 0) return [...accounts];
  return accounts.filter((account) => member.accountScope.includes(account.id));
}

export type DenialReason =
  | 'INSUFFICIENT_ROLE'
  | 'REAUTH_REQUIRED'
  | 'ACCOUNT_OUT_OF_SCOPE'
  | 'LAST_OWNER'
  | 'CANNOT_PROMOTE_TO_OWNER'
  | 'CANNOT_MODIFY_OWNER'
  | 'CANNOT_DEMOTE_SELF_AS_LAST_OWNER';

export interface Decision {
  allowed: boolean;
  reason?: DenialReason;
  /** Shown to the user. Says what is missing without leaking workspace structure. */
  message?: string;
}

const ALLOWED: Decision = { allowed: true };

function deny(reason: DenialReason, message: string): Decision {
  return { allowed: false, reason, message };
}

export interface AuthorizeInput {
  member: Member;
  capability: Capability;
  /** Minutes since the member last authenticated, for capabilities that require it. */
  minutesSinceAuth?: number;
  /** Set when the action targets a specific social account. */
  socialAccountId?: string;
}

/**
 * The single authorisation entry point. Returns a decision with a reason rather than a boolean, so the
 * UI can explain a refusal instead of hiding the control and leaving the user guessing.
 */
export function authorize(input: AuthorizeInput): Decision {
  const { member, capability, minutesSinceAuth, socialAccountId } = input;

  if (!can(member.role, capability)) {
    return deny('INSUFFICIENT_ROLE', `Your role (${member.role.toLowerCase()}) cannot perform this action.`);
  }

  if (socialAccountId !== undefined && !canAccessAccount(member, socialAccountId)) {
    return deny('ACCOUNT_OUT_OF_SCOPE', 'You do not have access to this account in this workspace.');
  }

  if (requiresRecentAuth(capability)) {
    // Absent evidence of recent authentication is treated as stale, never as fresh.
    const elapsed = minutesSinceAuth ?? Number.POSITIVE_INFINITY;
    if (elapsed > REAUTH_WINDOW_MINUTES) {
      return deny('REAUTH_REQUIRED', 'Confirm your password to continue. This action affects data or access.');
    }
  }

  return ALLOWED;
}

// ---------------------------------------------------------------------------
// Membership changes (ADR-0008 decision 5)
// ---------------------------------------------------------------------------

export interface RoleChangeInput {
  actor: Member;
  target: Member;
  newRole: WorkspaceRole;
  /** Number of OWNER members in the workspace, including the target. */
  ownerCount: number;
  minutesSinceAuth?: number;
}

export function authorizeRoleChange(input: RoleChangeInput): Decision {
  const { actor, target, newRole, ownerCount, minutesSinceAuth } = input;

  const base = authorize({ member: actor, capability: 'member.change_role', minutesSinceAuth });
  if (!base.allowed) return base;

  // An ADMIN who can grant OWNER is an OWNER with extra steps.
  if (newRole === 'OWNER' && actor.role !== 'OWNER') {
    return deny('CANNOT_PROMOTE_TO_OWNER', 'Only an owner can make someone else an owner.');
  }

  if (target.role === 'OWNER' && actor.role !== 'OWNER') {
    return deny('CANNOT_MODIFY_OWNER', "Only an owner can change another owner's role.");
  }

  // The workspace must never be left without an owner, including by an owner demoting themselves.
  if (target.role === 'OWNER' && newRole !== 'OWNER' && ownerCount <= 1) {
    const reason =
      actor.userId === target.userId ? 'CANNOT_DEMOTE_SELF_AS_LAST_OWNER' : 'LAST_OWNER';
    return deny(reason, 'A workspace needs at least one owner. Make someone else an owner first.');
  }

  return ALLOWED;
}

export interface RemovalInput {
  actor: Member;
  target: Member;
  ownerCount: number;
  minutesSinceAuth?: number;
}

export function authorizeRemoval(input: RemovalInput): Decision {
  const { actor, target, ownerCount, minutesSinceAuth } = input;

  const base = authorize({ member: actor, capability: 'member.remove', minutesSinceAuth });
  if (!base.allowed) return base;

  if (target.role === 'OWNER' && actor.role !== 'OWNER') {
    return deny('CANNOT_MODIFY_OWNER', 'Only an owner can remove another owner.');
  }

  if (target.role === 'OWNER' && ownerCount <= 1) {
    return deny('LAST_OWNER', 'A workspace needs at least one owner. Transfer ownership first.');
  }

  return ALLOWED;
}

/** Roles an actor is permitted to assign. Drives the role picker, so the UI cannot offer an illegal option. */
export function assignableRoles(actor: Member): readonly WorkspaceRole[] {
  if (!can(actor.role, 'member.change_role')) return [];
  if (actor.role === 'OWNER') return ROLE_ORDER;
  return ROLE_ORDER.filter((role) => role !== 'OWNER');
}

export const ROLE_DESCRIPTIONS: Record<WorkspaceRole, string> = {
  OWNER: 'Full control, including billing, deleting the workspace, and transferring ownership.',
  ADMIN: 'Manages members and platform connections, and can share reports with clients.',
  ANALYST: 'Runs analysis, corrects classifications, manages competitors, and exports reports.',
  VIEWER: 'Reads dashboards. Cannot export data or change anything.',
};
