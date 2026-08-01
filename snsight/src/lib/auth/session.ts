/**
 * Session lifetime (ADR-0008 decisions 1 and 7).
 *
 * Sessions are database rows rather than stateless tokens, because removing a member must revoke access
 * immediately. A JWT that stays valid for another 29 days after someone is removed from a workspace is
 * not acceptable for a product holding several clients' data in one account.
 *
 * Pure, with the clock injected.
 */

export const SESSION = {
  /** Hard ceiling. The session dies at this age regardless of activity. */
  absoluteMaxDays: 30,
  /** Inactivity ceiling. A shared laptop should not stay signed in for a month. */
  idleMaxDays: 14,
  /** Sliding refresh is skipped unless the record is at least this stale, to avoid a write per request. */
  refreshAfterMinutes: 15,
} as const;

export type SessionStatus = 'ACTIVE' | 'EXPIRED_IDLE' | 'EXPIRED_ABSOLUTE' | 'REVOKED';

export interface SessionRecord {
  readonly createdAt: Date;
  /** Updated on activity, at most once per `refreshAfterMinutes`. */
  readonly lastSeenAt: Date;
  /**
   * When the user last proved who they are: sign-in, or a password re-confirmation. Distinct from
   * `createdAt`, because re-confirming inside a long session must reopen the sensitive-action window
   * without minting a new session.
   */
  readonly authenticatedAt: Date;
  readonly revokedAt: Date | null;
}

export interface SessionEvaluation {
  readonly status: SessionStatus;
  readonly active: boolean;
  /** Drives `authorize({ minutesSinceAuth })` for sensitive capabilities. */
  readonly minutesSinceAuth: number;
  readonly expiresAt: Date;
  /** True when the caller should write back `lastSeenAt`. */
  readonly shouldRefresh: boolean;
  /** Explains a sign-out, so the login screen can say why rather than appearing to have forgotten. */
  readonly message?: string;
}

function days(count: number): number {
  return count * 86_400_000;
}

export function evaluateSession(record: SessionRecord, now: Date): SessionEvaluation {
  const absoluteExpiry = new Date(record.createdAt.getTime() + days(SESSION.absoluteMaxDays));
  const idleExpiry = new Date(record.lastSeenAt.getTime() + days(SESSION.idleMaxDays));
  const expiresAt = absoluteExpiry < idleExpiry ? absoluteExpiry : idleExpiry;
  const minutesSinceAuth = Math.floor((now.getTime() - record.authenticatedAt.getTime()) / 60_000);

  const base = { minutesSinceAuth, expiresAt, shouldRefresh: false };

  // Revocation is checked first: it must win over every other consideration.
  if (record.revokedAt !== null && record.revokedAt <= now) {
    return {
      ...base,
      status: 'REVOKED',
      active: false,
      message: 'You were signed out because your access to this workspace changed.',
    };
  }

  if (now >= absoluteExpiry) {
    return { ...base, status: 'EXPIRED_ABSOLUTE', active: false, message: 'Your session expired. Please sign in again.' };
  }

  if (now >= idleExpiry) {
    return {
      ...base,
      status: 'EXPIRED_IDLE',
      active: false,
      message: 'You were signed out after a period of inactivity. Please sign in again.',
    };
  }

  const staleMinutes = (now.getTime() - record.lastSeenAt.getTime()) / 60_000;
  return { ...base, status: 'ACTIVE', active: true, shouldRefresh: staleMinutes >= SESSION.refreshAfterMinutes };
}

/** Applied when a user re-confirms their password, reopening the sensitive-action window in place. */
export function withRefreshedAuth(record: SessionRecord, now: Date): SessionRecord {
  return { ...record, authenticatedAt: now, lastSeenAt: now };
}

export function touch(record: SessionRecord, now: Date): SessionRecord {
  return { ...record, lastSeenAt: now };
}

/**
 * Cookie attributes. `sameSite: 'lax'` rather than `strict` so that returning from the Meta OAuth
 * redirect keeps the session; `strict` would drop it and strand the user mid-connection.
 */
export const SESSION_COOKIE = {
  name: 'snsight.session',
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  /** Set false only for local http development. */
  secure: true,
} as const;
