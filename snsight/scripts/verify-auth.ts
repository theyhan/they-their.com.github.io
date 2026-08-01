/**
 * Authentication and authorisation checks (ADR-0008).
 *
 * The most security-sensitive logic in the project, so it carries the most checks. Several assertions
 * exist specifically to fail if someone "simplifies" an invariant later: that a viewer cannot export,
 * that an admin cannot mint owners, that a workspace cannot be left ownerless, and that the login form
 * cannot be used to discover which email addresses have accounts.
 *
 * Run with `bun scripts/verify-auth.ts`.
 */

import {
  assignableRoles,
  authorize,
  authorizeRemoval,
  authorizeRoleChange,
  can,
  capabilitiesOf,
  canAccessAccount,
  REAUTH_WINDOW_MINUTES,
  requiresRecentAuth,
  ROLE_DESCRIPTIONS,
  ROLE_ORDER,
  visibleAccounts,
  type Capability,
  type Member,
  type WorkspaceRole,
} from '../src/lib/auth/permissions.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, validatePassword } from '../src/lib/auth/password.js';
import {
  describeCredentialOutcome,
  evaluateThrottle,
  GENERIC_LOGIN_FAILURE,
  requiresDummyHashComputation,
  THROTTLE,
  type LoginAttemptRecord,
} from '../src/lib/auth/rate-limit.js';
import { evaluateSession, SESSION, SESSION_COOKIE, withRefreshedAuth, type SessionRecord } from '../src/lib/auth/session.js';
import {
  checkQuota,
  dailyBucket,
  deriveSlug,
  deriveWorkspaceName,
  PLAN_LIMITS,
  planOnboarding,
  resolveViewState,
  VIEW_STATE_COPY,
} from '../src/lib/auth/onboarding.js';
import { check, expect, report } from './harness.js';

function member(role: WorkspaceRole, overrides: Partial<Member> = {}): Member {
  return {
    userId: overrides.userId ?? `user_${role.toLowerCase()}`,
    workspaceId: 'ws_1',
    role,
    accountScope: overrides.accountScope ?? [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Capability matrix
// ---------------------------------------------------------------------------

check('a viewer can read dashboards and nothing else', () => {
  const caps = capabilitiesOf('VIEWER');
  expect(caps.length === 1 && caps[0] === 'dashboard.view', `viewer has ${caps.join(', ')}`);
});

check('a viewer cannot export, because export is bulk data egress', () => {
  // Named separately: this is the invariant most likely to be "simplified" by folding export into view.
  expect(!can('VIEWER', 'report.export'), 'a viewer must not be able to export CSV or PDF');
  expect(!can('VIEWER', 'report.create'), 'a viewer must not be able to generate reports');
  expect(!can('VIEWER', 'report.share'), 'a viewer must not be able to create share links');
});

check('an analyst does analysis but does not administer', () => {
  for (const capability of ['analysis.run', 'classification.correct', 'competitor.manage', 'report.export'] as Capability[]) {
    expect(can('ANALYST', capability), `analyst should have ${capability}`);
  }
  for (const capability of ['account.connect', 'account.disconnect', 'member.invite', 'member.remove', 'report.share'] as Capability[]) {
    expect(!can('ANALYST', capability), `analyst must not have ${capability}`);
  }
});

check('an admin administers but does not own', () => {
  for (const capability of ['member.invite', 'member.remove', 'account.connect', 'report.share', 'audit.view'] as Capability[]) {
    expect(can('ADMIN', capability), `admin should have ${capability}`);
  }
  expect(!can('ADMIN', 'workspace.delete'), 'an admin must not be able to delete the workspace');
  expect(!can('ADMIN', 'billing.manage'), 'an admin must not manage billing');
});

check('roles nest: each role includes everything the one below it can do', () => {
  for (let i = 1; i < ROLE_ORDER.length; i += 1) {
    const lower = capabilitiesOf(ROLE_ORDER[i - 1]!);
    const higher = capabilitiesOf(ROLE_ORDER[i]!);
    for (const capability of lower) {
      expect(higher.includes(capability), `${ROLE_ORDER[i]} is missing ${capability} held by ${ROLE_ORDER[i - 1]}`);
    }
    expect(higher.length > lower.length, `${ROLE_ORDER[i]} should add capabilities over ${ROLE_ORDER[i - 1]}`);
  }
});

check('every role is documented for the role picker', () => {
  for (const role of ROLE_ORDER) {
    expect((ROLE_DESCRIPTIONS[role] ?? '').length > 20, `${role} needs a description users can act on`);
  }
});

// ---------------------------------------------------------------------------
// authorize()
// ---------------------------------------------------------------------------

check('a refusal explains itself instead of silently failing', () => {
  const decision = authorize({ member: member('VIEWER'), capability: 'report.export' });
  expect(!decision.allowed, 'a viewer must be refused');
  expect(decision.reason === 'INSUFFICIENT_ROLE', `got ${decision.reason}`);
  expect((decision.message ?? '').length > 0, 'a refusal needs a message the UI can show');
});

check('missing proof of recent authentication is treated as stale, not fresh', () => {
  // The dangerous default. Omitting the field must never grant a sensitive action.
  const decision = authorize({ member: member('OWNER'), capability: 'account.disconnect' });
  expect(!decision.allowed, 'an owner without recent-auth evidence must be refused');
  expect(decision.reason === 'REAUTH_REQUIRED', `got ${decision.reason}`);
});

check('recent authentication unlocks sensitive actions inside the window', () => {
  const fresh = authorize({ member: member('OWNER'), capability: 'account.disconnect', minutesSinceAuth: 2 });
  expect(fresh.allowed, 'recent authentication should permit the action');

  const stale = authorize({
    member: member('OWNER'),
    capability: 'account.disconnect',
    minutesSinceAuth: REAUTH_WINDOW_MINUTES + 1,
  });
  expect(!stale.allowed && stale.reason === 'REAUTH_REQUIRED', 'past the window it must be refused again');
});

check('routine actions do not demand re-authentication', () => {
  expect(!requiresRecentAuth('dashboard.view'), 'viewing must not prompt for a password');
  expect(!requiresRecentAuth('analysis.run'), 'running analysis must not prompt for a password');
  expect(requiresRecentAuth('workspace.delete'), 'deleting a workspace must prompt');
  expect(requiresRecentAuth('member.change_role'), 'changing a role must prompt');
});

check('account scope restricts data access for every role, owners included', () => {
  const scoped = member('OWNER', { accountScope: ['acc_a'] });
  expect(canAccessAccount(scoped, 'acc_a'), 'the scoped account is readable');
  expect(!canAccessAccount(scoped, 'acc_b'), 'an owner with a scope must not read outside it');

  const decision = authorize({ member: scoped, capability: 'dashboard.view', socialAccountId: 'acc_b' });
  expect(!decision.allowed && decision.reason === 'ACCOUNT_OUT_OF_SCOPE', `got ${decision.reason}`);
});

check('an empty scope means every account', () => {
  const unscoped = member('ANALYST');
  expect(canAccessAccount(unscoped, 'anything'), 'an empty scope grants all accounts');
  const accounts = [{ id: 'acc_a' }, { id: 'acc_b' }];
  expect(visibleAccounts(unscoped, accounts).length === 2, 'all accounts should be visible');
  expect(visibleAccounts(member('VIEWER', { accountScope: ['acc_b'] }), accounts).length === 1, 'scope should filter');
});

// ---------------------------------------------------------------------------
// Membership invariants
// ---------------------------------------------------------------------------

const owner = member('OWNER', { userId: 'u_owner' });
const secondOwner = member('OWNER', { userId: 'u_owner2' });
const admin = member('ADMIN', { userId: 'u_admin' });
const analyst = member('ANALYST', { userId: 'u_analyst' });

check('an admin cannot create owners, including themselves', () => {
  const other = authorizeRoleChange({ actor: admin, target: analyst, newRole: 'OWNER', ownerCount: 1, minutesSinceAuth: 1 });
  expect(!other.allowed && other.reason === 'CANNOT_PROMOTE_TO_OWNER', `got ${other.reason}`);

  const self = authorizeRoleChange({ actor: admin, target: admin, newRole: 'OWNER', ownerCount: 1, minutesSinceAuth: 1 });
  expect(!self.allowed && self.reason === 'CANNOT_PROMOTE_TO_OWNER', 'self-promotion must be refused');
});

check('an admin cannot change or remove an owner', () => {
  const change = authorizeRoleChange({ actor: admin, target: owner, newRole: 'VIEWER', ownerCount: 2, minutesSinceAuth: 1 });
  expect(!change.allowed && change.reason === 'CANNOT_MODIFY_OWNER', `got ${change.reason}`);

  const removal = authorizeRemoval({ actor: admin, target: owner, ownerCount: 2, minutesSinceAuth: 1 });
  expect(!removal.allowed && removal.reason === 'CANNOT_MODIFY_OWNER', `got ${removal.reason}`);
});

check('a workspace cannot be left without an owner', () => {
  const demoteSelf = authorizeRoleChange({ actor: owner, target: owner, newRole: 'ADMIN', ownerCount: 1, minutesSinceAuth: 1 });
  expect(!demoteSelf.allowed, 'the last owner must not be able to demote themselves');
  expect(demoteSelf.reason === 'CANNOT_DEMOTE_SELF_AS_LAST_OWNER', `got ${demoteSelf.reason}`);

  const removeLast = authorizeRemoval({ actor: owner, target: owner, ownerCount: 1, minutesSinceAuth: 1 });
  expect(!removeLast.allowed && removeLast.reason === 'LAST_OWNER', `got ${removeLast.reason}`);
});

check('with two owners, one may step down', () => {
  const decision = authorizeRoleChange({ actor: owner, target: secondOwner, newRole: 'ADMIN', ownerCount: 2, minutesSinceAuth: 1 });
  expect(decision.allowed, `expected the change to be allowed, got ${decision.reason}`);

  const removal = authorizeRemoval({ actor: owner, target: secondOwner, ownerCount: 2, minutesSinceAuth: 1 });
  expect(removal.allowed, `expected the removal to be allowed, got ${removal.reason}`);
});

check('role changes still require recent authentication', () => {
  const decision = authorizeRoleChange({ actor: owner, target: analyst, newRole: 'ADMIN', ownerCount: 2 });
  expect(!decision.allowed && decision.reason === 'REAUTH_REQUIRED', `got ${decision.reason}`);
});

check('the role picker cannot offer an illegal option', () => {
  expect(assignableRoles(owner).includes('OWNER'), 'an owner may grant ownership');
  expect(!assignableRoles(admin).includes('OWNER'), 'an admin must not see OWNER in the picker');
  expect(assignableRoles(admin).length === 3, `admin should assign three roles, got ${assignableRoles(admin).length}`);
  expect(assignableRoles(analyst).length === 0, 'an analyst manages nobody');
  expect(assignableRoles(member('VIEWER')).length === 0, 'a viewer manages nobody');
});

// ---------------------------------------------------------------------------
// Password policy
// ---------------------------------------------------------------------------

check('length is the primary requirement', () => {
  expect(!validatePassword('short').valid, 'a short password must be refused');
  expect(validatePassword('short').problems.includes('TOO_SHORT'), 'the reason must be length');
  expect(validatePassword('kettle harbour lantern').valid, 'a long passphrase should be accepted');
  expect(!validatePassword('x'.repeat(PASSWORD_MAX_LENGTH + 1)).valid, 'an over-long password must be refused');
});

check('whitespace cannot pad a short password to the minimum', () => {
  const padded = `abc${' '.repeat(PASSWORD_MIN_LENGTH)}`;
  expect(padded.length > PASSWORD_MIN_LENGTH, 'the raw string is long enough to fool a naive check');
  expect(!validatePassword(padded).valid, 'padding with spaces must not satisfy the length rule');
  expect(validatePassword(padded).problems.includes('TOO_SHORT'), 'it should be reported as too short');
});

check('predictable passwords are refused', () => {
  expect(validatePassword('correcthorsebatterystaple').problems.includes('COMMON'), 'a famous example is now common');
  expect(!validatePassword('password123').valid, 'a common password must be refused');
  expect(validatePassword('aaaaaaaaaaaaaaa').problems.includes('REPEATED_CHARACTER'), 'a single repeated character is not entropy');
  expect(validatePassword('abcdefghijklm').problems.includes('SEQUENTIAL'), 'an alphabet run must be refused');
  expect(validatePassword('qwertyuiop1234').problems.includes('SEQUENTIAL'), 'a keyboard run must be refused');
});

check('a password may not contain the email local part', () => {
  const verdict = validatePassword('jiwon-secret-phrase', 'jiwon@example.com');
  expect(verdict.problems.includes('CONTAINS_EMAIL'), 'reusing the email in the password must be refused');
  // A very short local part would otherwise match almost everything.
  expect(!validatePassword('kettle harbour lantern', 'ab@example.com').problems.includes('CONTAINS_EMAIL'), 'a two-letter local part must not trigger this');
});

check('every refusal carries a sentence the user can act on', () => {
  const verdict = validatePassword('abc');
  expect(verdict.messages.length === verdict.problems.length, 'each problem needs a message');
  for (const message of verdict.messages) {
    expect(message.length > 15, `message too terse: ${message}`);
  }
});

check('the strength meter advises but never gates', () => {
  // An unusual long password must be accepted even if the crude estimator calls it weak.
  const unusual = validatePassword('ᚠᚢᚦᚨᚱᚲ ᚷᛖᛒᛟ ᛚᚨᚷᚢ');
  expect(unusual.valid, 'a valid long password must not be blocked by the meter');
  expect(['WEAK', 'FAIR', 'STRONG'].includes(unusual.strength), 'a strength label must still be produced');
  expect(validatePassword('Tr0ub4dor&3xample!Long').strength !== 'WEAK', 'a mixed long password should not read as weak');
});

// ---------------------------------------------------------------------------
// Login throttling and enumeration
// ---------------------------------------------------------------------------

const now = new Date('2026-08-01T12:00:00Z');

/**
 * `count` failures ending `lastFailureMinutesAgo` minutes before `now`, spaced 12 seconds apart.
 *
 * An earlier version of this helper walked forwards and generated future-dated attempts, which the
 * implementation correctly ignores - so the test failed for a reason unrelated to what it was checking.
 * Every timestamp here is in the past on purpose.
 */
function failures(count: number, lastFailureMinutesAgo = 2): LoginAttemptRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    at: new Date(now.getTime() - (lastFailureMinutesAgo + (count - 1 - i) * 0.2) * 60_000),
    successful: false,
  }));
}

check('a few mistakes do not lock the account', () => {
  const verdict = evaluateThrottle({ attempts: failures(THROTTLE.softLimit - 1), now });
  expect(verdict.allowed, 'below the limit must be allowed');
  expect(verdict.severity === 'NONE', `expected no severity, got ${verdict.severity}`);
});

check('the soft limit locks the account and says how long', () => {
  const verdict = evaluateThrottle({ attempts: failures(THROTTLE.softLimit, 2), now });
  expect(!verdict.allowed, 'at the limit it must lock');
  expect(verdict.severity === 'SOFT', `expected SOFT, got ${verdict.severity}`);
  expect(verdict.retryAfterSeconds > 0, 'a lockout needs a retry time');
  expect((verdict.message ?? '').includes('Try again'), 'the user must be told to wait');
});

check('sustained attempts escalate to a longer lockout', () => {
  const verdict = evaluateThrottle({ attempts: failures(THROTTLE.hardLimit, 3), now });
  expect(!verdict.allowed && verdict.severity === 'HARD', `expected HARD, got ${verdict.severity}`);
  expect(verdict.retryAfterSeconds > THROTTLE.softLockMinutes * 60, 'the escalated lockout must be longer');
});

check('a successful sign-in clears earlier failures', () => {
  const attempts: LoginAttemptRecord[] = [
    ...failures(THROTTLE.softLimit, 12),
    { at: new Date(now.getTime() - 60_000), successful: true },
    { at: new Date(now.getTime() - 30_000), successful: false },
  ];
  const verdict = evaluateThrottle({ attempts, now });
  expect(verdict.allowed, 'failures before a success must not count');
  expect(verdict.failuresInWindow === 1, `expected 1 failure since success, got ${verdict.failuresInWindow}`);
});

check('failures older than the window are ignored', () => {
  const old = Array.from({ length: 20 }, (_, i) => ({
    at: new Date(now.getTime() - (THROTTLE.lookbackMinutes + 10 + i) * 60_000),
    successful: false,
  }));
  const verdict = evaluateThrottle({ attempts: old, now });
  expect(verdict.allowed, 'stale failures must not lock the account forever');
  expect(verdict.failuresInWindow === 0, `expected 0 in window, got ${verdict.failuresInWindow}`);
});

check('the lockout ends without granting a fresh allowance', () => {
  const attempts = failures(THROTTLE.softLimit, 1);
  const duringLock = evaluateThrottle({ attempts, now });
  expect(!duringLock.allowed, 'the account starts locked');

  // Past the lock but still inside the lookback, so the failures are still counted.
  const later = new Date(now.getTime() + (THROTTLE.softLockMinutes + 1) * 60_000);
  const verdict = evaluateThrottle({ attempts, now: later });
  expect(verdict.allowed, 'after the lock elapses an attempt is permitted');
  expect(verdict.failuresInWindow >= THROTTLE.softLimit, 'the counter is not reset, so one more failure re-locks');
  expect(verdict.severity === 'SOFT', 'the severity is retained for auditing');
});

check('an escalated lockout actually holds for its full duration', () => {
  // The bug this catches: counting failures over a shorter window than the lockout let a 60-minute
  // lock expire after 15, because the failures that caused it aged out of the count.
  const attempts = failures(THROTTLE.hardLimit, 1);
  const afterSoftWindow = new Date(now.getTime() + (THROTTLE.softLockMinutes + 5) * 60_000);
  const midLock = evaluateThrottle({ attempts, now: afterSoftWindow });
  expect(!midLock.allowed, 'the hard lockout must still be in force 20 minutes in');
  expect(midLock.severity === 'HARD', `expected HARD, got ${midLock.severity}`);

  const afterHardLock = new Date(now.getTime() + (THROTTLE.hardLockMinutes + 1) * 60_000);
  expect(evaluateThrottle({ attempts, now: afterHardLock }).allowed, 'and must end when it expires');
});

check('the login form is not an account-enumeration oracle', () => {
  const unknown = describeCredentialOutcome('UNKNOWN_EMAIL');
  const wrong = describeCredentialOutcome('WRONG_PASSWORD');
  const noPassword = describeCredentialOutcome('NO_PASSWORD_SET');

  expect(unknown.message === wrong.message, 'unknown email and wrong password must read identically');
  expect(wrong.message === noPassword.message, 'a social-only account must not be distinguishable');
  expect(unknown.message === GENERIC_LOGIN_FAILURE, 'the shared message must be the generic one');
  expect(!unknown.ok && !wrong.ok && !noPassword.ok, 'none of these may succeed');
  // The internal outcome is kept for the audit log, and must not leak into the response text.
  expect(!(unknown.message ?? '').toLowerCase().includes('exist'), 'the message must not hint at existence');
  expect(!(unknown.message ?? '').toLowerCase().includes('unknown'), 'the message must not hint at existence');
});

check('timing does not reveal whether an account exists', () => {
  // Skipping the hash for an unknown email makes that path faster and turns latency into an oracle.
  expect(requiresDummyHashComputation('UNKNOWN_EMAIL'), 'an unknown email must still cost a hash');
  expect(requiresDummyHashComputation('NO_PASSWORD_SET'), 'an account without a password must still cost a hash');
  expect(!requiresDummyHashComputation('WRONG_PASSWORD'), 'a real hash is already computed here');
});

check('the lockout message does not count down remaining attempts', () => {
  const verdict = evaluateThrottle({ attempts: failures(THROTTLE.softLimit, 2), now });
  const message = verdict.message ?? '';
  expect(!/\d+ attempts? (left|remaining)/i.test(message), 'do not tell an attacker how to pace requests');
});

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    createdAt: new Date(now.getTime() - 60_000),
    lastSeenAt: new Date(now.getTime() - 60_000),
    authenticatedAt: new Date(now.getTime() - 60_000),
    revokedAt: null,
    ...overrides,
  };
}

check('a fresh session is active and does not need a write', () => {
  const evaluation = evaluateSession(session(), now);
  expect(evaluation.active && evaluation.status === 'ACTIVE', `got ${evaluation.status}`);
  expect(!evaluation.shouldRefresh, 'a session seen a minute ago should not be written back');
  expect(evaluation.minutesSinceAuth === 1, `expected 1 minute since auth, got ${evaluation.minutesSinceAuth}`);
});

check('activity is written back only once the record is stale', () => {
  const stale = session({ lastSeenAt: new Date(now.getTime() - (SESSION.refreshAfterMinutes + 1) * 60_000) });
  expect(evaluateSession(stale, now).shouldRefresh, 'a stale record should be refreshed');
});

check('inactivity ends a session before its absolute limit', () => {
  const idle = session({
    createdAt: new Date(now.getTime() - 20 * 86_400_000),
    lastSeenAt: new Date(now.getTime() - (SESSION.idleMaxDays + 1) * 86_400_000),
  });
  const evaluation = evaluateSession(idle, now);
  expect(evaluation.status === 'EXPIRED_IDLE' && !evaluation.active, `got ${evaluation.status}`);
  expect((evaluation.message ?? '').includes('inactivity'), 'the user should be told why they were signed out');
});

check('the absolute ceiling applies even to a session in constant use', () => {
  const old = session({
    createdAt: new Date(now.getTime() - (SESSION.absoluteMaxDays + 1) * 86_400_000),
    lastSeenAt: now,
    authenticatedAt: now,
  });
  const evaluation = evaluateSession(old, now);
  expect(evaluation.status === 'EXPIRED_ABSOLUTE', `got ${evaluation.status}`);
});

check('revocation takes precedence over everything', () => {
  const revoked = session({ revokedAt: new Date(now.getTime() - 1000) });
  const evaluation = evaluateSession(revoked, now);
  expect(evaluation.status === 'REVOKED' && !evaluation.active, `got ${evaluation.status}`);
  expect((evaluation.message ?? '').length > 0, 'a revoked session should explain itself');
  // A future-dated revocation must not sign anyone out early.
  expect(evaluateSession(session({ revokedAt: new Date(now.getTime() + 60_000) }), now).active, 'a future revocation is not yet effective');
});

check('re-confirming a password reopens the sensitive window without a new session', () => {
  const longRunning = session({ authenticatedAt: new Date(now.getTime() - 3 * 86_400_000) });
  const before = evaluateSession(longRunning, now);
  expect(before.minutesSinceAuth > REAUTH_WINDOW_MINUTES, 'the window should be closed');
  expect(!authorize({ member: owner, capability: 'workspace.delete', minutesSinceAuth: before.minutesSinceAuth }).allowed, 'and the action refused');

  const after = evaluateSession(withRefreshedAuth(longRunning, now), now);
  expect(after.minutesSinceAuth === 0, 'after re-confirmation the window is open');
  expect(after.status === 'ACTIVE', 'the session itself is unchanged');
  expect(
    authorize({ member: owner, capability: 'workspace.delete', minutesSinceAuth: after.minutesSinceAuth }).allowed,
    'and the action is permitted',
  );
});

check('the session cookie survives the Meta OAuth round trip', () => {
  // `strict` would drop the cookie on the redirect back from Meta and strand the user mid-connection.
  expect(SESSION_COOKIE.sameSite === 'lax', 'sameSite must be lax for the OAuth return');
  expect(SESSION_COOKIE.httpOnly, 'the session cookie must not be readable by scripts');
  expect(SESSION_COOKIE.secure, 'the session cookie must require TLS');
});

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

check('a new signup owns a free workspace', () => {
  const plan = planOnboarding({ email: 'jiwon@example.com' });
  expect(plan.role === 'OWNER', 'the creator must be an owner or nobody can administer the workspace');
  expect(plan.planTier === 'FREE', 'a paid plan must be a deliberate later choice');
  expect(!plan.isDemo, 'a real signup is not a demo workspace');
  expect(plan.slug === 'jiwon', `unexpected slug ${plan.slug}`);
});

check('slugs avoid collisions and reserved words', () => {
  expect(deriveSlug('jiwon@example.com', new Set(['jiwon'])) === 'jiwon-2', 'a collision should get a suffix');
  expect(deriveSlug('jiwon@example.com', new Set(['jiwon', 'jiwon-2'])) === 'jiwon-3', 'suffixes should continue');
  expect(deriveSlug('admin@example.com') === 'admin-workspace', 'a reserved slug must be avoided');
  expect(deriveSlug('dashboard@example.com') === 'dashboard-workspace', 'route names must not become slugs');
  expect(deriveSlug('ab@example.com').length >= 3, 'a very short local part must be padded');
  expect(!deriveSlug('J.iwon_Park+tag@example.com').includes('+'), 'slugs must be url safe');
  expect(/^[a-z0-9-]+$/.test(deriveSlug('J.iwon_Park+tag@example.com')), 'slugs must be lowercase alphanumeric');
});

check('workspace names read like something a person would write', () => {
  expect(deriveWorkspaceName('jiwon.park@example.com') === 'Jiwon Park workspace', deriveWorkspaceName('jiwon.park@example.com'));
  expect(deriveWorkspaceName('x@example.com', 'Jiwon') === "Jiwon's workspace", 'a display name should be preferred');
});

check('a signed-in user with no connected accounts sees the demo, not an empty page', () => {
  expect(resolveViewState({ connectedAccountCount: 0, unhealthyAccountCount: 0 }) === 'DEMO_NO_ACCOUNTS', 'zero accounts is the demo state');
  expect(resolveViewState({ connectedAccountCount: 2, unhealthyAccountCount: 0 }) === 'READY', 'healthy accounts are ready');
  expect(resolveViewState({ connectedAccountCount: 2, unhealthyAccountCount: 2 }) === 'NEEDS_RECONNECT', 'all-unhealthy needs attention');
  expect(resolveViewState({ connectedAccountCount: 2, unhealthyAccountCount: 1 }) === 'READY', 'partial health still shows data');
});

check('the demo state states that signing in did not connect an account', () => {
  // ADR-0008 decision 3. The confusion this prevents is the most likely first support question.
  const copy = VIEW_STATE_COPY.DEMO_NO_ACCOUNTS;
  expect(copy.body.toLowerCase().includes('did not connect'), 'the copy must correct the assumption explicitly');
  expect(copy.action.length > 0, 'the empty state needs an action');
});

check('plan limits are enforceable and match section 11', () => {
  expect(PLAN_LIMITS.FREE.connectedAccounts === 1, 'free is one connected account');
  expect(PLAN_LIMITS.FREE.analysesPerDay === 3, 'free is three analyses per day');
  expect(PLAN_LIMITS.FREE.competitorAccounts === 0, 'competitor monitoring is a paid feature');
  expect(PLAN_LIMITS.PRO.competitorAccounts === 10, 'pro is ten competitors');

  const allowed = checkQuota('FREE', 'analysesPerDay', 2);
  expect(allowed.allowed, 'under the limit must be allowed');
  const blocked = checkQuota('FREE', 'analysesPerDay', 3);
  expect(!blocked.allowed, 'at the limit must be blocked');
  expect((blocked.message ?? '').includes('3'), 'the message should quote the limit');
});

check('daily quota buckets are UTC, so "per day" is unambiguous', () => {
  expect(dailyBucket(new Date('2026-08-01T23:59:59Z')) === '2026-08-01', 'late UTC is still the same day');
  expect(dailyBucket(new Date('2026-08-02T00:00:01Z')) === '2026-08-02', 'the bucket rolls at UTC midnight');
});

await report('Authentication, authorisation, sessions and onboarding verified.');
