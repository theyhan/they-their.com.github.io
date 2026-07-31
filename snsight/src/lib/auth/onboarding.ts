/**
 * Onboarding decisions (FR-001, SCR-001, ADR-0008 consequences).
 *
 * Pure so the rules are verified by execution: the workspace shape a new user gets, the slug, and when
 * the demo dashboard is shown instead of an empty one.
 */

import type { WorkspaceRole } from './permissions.js';

export type PlanTier = 'FREE' | 'PRO' | 'AGENCY';

/** Section 11. Enforced through `usage_counters` (ADR-0005). */
export const PLAN_LIMITS: Record<PlanTier, { connectedAccounts: number; competitorAccounts: number; analysesPerDay: number; reportsPerMonth: number; retentionDays: number }> = {
  FREE: { connectedAccounts: 1, competitorAccounts: 0, analysesPerDay: 3, reportsPerMonth: 1, retentionDays: 30 },
  PRO: { connectedAccounts: 5, competitorAccounts: 10, analysesPerDay: 50, reportsPerMonth: 100, retentionDays: 730 },
  AGENCY: { connectedAccounts: 25, competitorAccounts: 50, analysesPerDay: 250, reportsPerMonth: 1000, retentionDays: 1825 },
};

export interface OnboardingPlan {
  readonly workspaceName: string;
  readonly slug: string;
  readonly role: WorkspaceRole;
  readonly planTier: PlanTier;
  /** Fixture-backed workspaces are marked (ADR-0007 decision 5). A real signup never is. */
  readonly isDemo: boolean;
}

const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'api',
  'app',
  'admin',
  'login',
  'logout',
  'signup',
  'settings',
  'dashboard',
  'demo',
  'help',
  'support',
  'status',
  'billing',
  'new',
  'snsight',
]);

/**
 * Slug from an email local part. Collisions get a numeric suffix rather than failing, because a signup
 * must not be blocked by a stranger having a similar address.
 */
export function deriveSlug(email: string, taken: ReadonlySet<string> = new Set()): string {
  const localPart = email.split('@')[0] ?? 'workspace';
  let base = localPart
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);

  if (base.length < 3) base = `${base}-workspace`.replace(/^-+/, '');
  if (RESERVED_SLUGS.has(base)) base = `${base}-workspace`;

  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Deterministic fallback rather than an unbounded loop.
  return `${base}-${Date.now().toString(36)}`;
}

export function deriveWorkspaceName(email: string, displayName?: string | null): string {
  if (displayName && displayName.trim().length > 0) return `${displayName.trim()}'s workspace`;
  const localPart = email.split('@')[0] ?? 'My';
  const cleaned = localPart.replace(/[._-]+/g, ' ').trim();
  const titled = cleaned
    .split(' ')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  return `${titled || 'My'} workspace`;
}

export interface OnboardingInput {
  email: string;
  displayName?: string | null;
  takenSlugs?: ReadonlySet<string>;
}

/**
 * The first workspace. Always FREE and always OWNER: a paid plan is a later, deliberate choice, and the
 * creator must be an owner or the workspace would start with nobody able to administer it.
 */
export function planOnboarding(input: OnboardingInput): OnboardingPlan {
  return {
    workspaceName: deriveWorkspaceName(input.email, input.displayName),
    slug: deriveSlug(input.email, input.takenSlugs ?? new Set()),
    role: 'OWNER',
    planTier: 'FREE',
    isDemo: false,
  };
}

export type WorkspaceViewState = 'DEMO_NO_ACCOUNTS' | 'NEEDS_RECONNECT' | 'READY';

export interface ViewStateInput {
  readonly connectedAccountCount: number;
  /** Accounts whose connection is not currently usable (ADR-0002 decision 4). */
  readonly unhealthyAccountCount: number;
}

/**
 * What a signed-in user sees.
 *
 * A new user has no connected accounts, which is the normal state rather than an error. SCR-001 asks for
 * a demo dashboard before connection, so that state gets fixture data behind a banner: an honest empty
 * state that also demonstrates the product.
 */
export function resolveViewState(input: ViewStateInput): WorkspaceViewState {
  if (input.connectedAccountCount === 0) return 'DEMO_NO_ACCOUNTS';
  if (input.unhealthyAccountCount >= input.connectedAccountCount) return 'NEEDS_RECONNECT';
  return 'READY';
}

export const VIEW_STATE_COPY: Record<WorkspaceViewState, { heading: string; body: string; action: string }> = {
  DEMO_NO_ACCOUNTS: {
    heading: 'This is sample data',
    body: 'Connect an Instagram or Threads account to see your own numbers here. Signing in did not connect an account, and no permission has been granted yet.',
    action: 'Connect an account',
  },
  NEEDS_RECONNECT: {
    heading: 'Collection has stopped',
    body: 'Every connected account needs attention, so the figures below are not advancing. Data already collected is unaffected.',
    action: 'Review connections',
  },
  READY: {
    heading: '',
    body: '',
    action: '',
  },
};

export interface QuotaCheck {
  readonly allowed: boolean;
  readonly used: number;
  readonly limit: number;
  readonly message?: string;
}

/** Section 11 limits. Daily counters use UTC buckets unless the workspace overrides it (ADR-0005). */
export function checkQuota(plan: PlanTier, metric: keyof (typeof PLAN_LIMITS)['FREE'], used: number): QuotaCheck {
  const limit = PLAN_LIMITS[plan][metric];
  if (used < limit) return { allowed: true, used, limit };
  return {
    allowed: false,
    used,
    limit,
    message: `Your ${plan.toLowerCase()} plan includes ${limit} per period, and you have used ${used}. Upgrade to continue.`,
  };
}

/** UTC day bucket for `usage_counters`, so "three per day" is unambiguous across time zones. */
export function dailyBucket(now: Date): string {
  return now.toISOString().slice(0, 10);
}
