/**
 * Login throttling (ADR-0008 decision 8).
 *
 * Two jobs. Slow down credential stuffing, and never let the form become an account-enumeration
 * oracle: an unknown email and a wrong password must be indistinguishable in message, in throttling
 * behaviour, and in timing class.
 *
 * Pure, with the clock injected, so lockout windows are verified by execution rather than by waiting.
 */

export const THROTTLE = {
  /**
   * How far back failures are remembered.
   *
   * This must be at least as long as the longest lockout. An earlier version counted failures over 15
   * minutes while locking for 60, which meant the escalated lockout could never actually hold: the
   * failures that triggered it aged out of the counting window after 15 minutes and the account
   * unlocked itself. Keeping the lookback equal to the longest lockout is what makes the lockout real.
   */
  lookbackMinutes: 60,
  /** Failures before the first lockout. */
  softLimit: 5,
  softLockMinutes: 15,
  /** Failures before the escalated lockout. */
  hardLimit: 10,
  hardLockMinutes: 60,
} as const;

export interface LoginAttemptRecord {
  readonly at: Date;
  readonly successful: boolean;
}

export interface ThrottleInput {
  /** Attempts for this email and client address, newest or oldest order is irrelevant. */
  readonly attempts: readonly LoginAttemptRecord[];
  readonly now: Date;
}

export interface ThrottleVerdict {
  readonly allowed: boolean;
  readonly failuresInWindow: number;
  readonly retryAfterSeconds: number;
  readonly lockedUntil: Date | null;
  /** Escalated lockouts are worth an alert; a user forgetting a password is not. */
  readonly severity: 'NONE' | 'SOFT' | 'HARD';
  /**
   * Shown to the user. Deliberately identical whether or not the email exists, and it does not reveal
   * how many attempts remain, which would help an attacker pace their requests.
   */
  readonly message?: string;
}

function minutesToMs(minutes: number): number {
  return minutes * 60_000;
}

/**
 * Only failures after the most recent success count. A successful sign-in clears the slate, so a user
 * who signs in correctly is not locked out by yesterday's typos.
 */
export function failuresSinceLastSuccess(
  attempts: readonly LoginAttemptRecord[],
  now: Date,
  lookbackMinutes: number = THROTTLE.lookbackMinutes,
): LoginAttemptRecord[] {
  const windowStart = new Date(now.getTime() - minutesToMs(lookbackMinutes));
  const inWindow = attempts
    .filter((attempt) => attempt.at > windowStart && attempt.at <= now)
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  let lastSuccessIndex = -1;
  for (let i = inWindow.length - 1; i >= 0; i -= 1) {
    if (inWindow[i]!.successful) {
      lastSuccessIndex = i;
      break;
    }
  }
  return inWindow.slice(lastSuccessIndex + 1).filter((attempt) => !attempt.successful);
}

export function evaluateThrottle(input: ThrottleInput): ThrottleVerdict {
  const { attempts, now } = input;
  const failures = failuresSinceLastSuccess(attempts, now);
  const count = failures.length;

  if (count < THROTTLE.softLimit) {
    return { allowed: true, failuresInWindow: count, retryAfterSeconds: 0, lockedUntil: null, severity: 'NONE' };
  }

  const escalated = count >= THROTTLE.hardLimit;
  const lockMinutes = escalated ? THROTTLE.hardLockMinutes : THROTTLE.softLockMinutes;
  // The lockout runs from the most recent failure, so continued attempts extend it.
  const lastFailure = failures[failures.length - 1]!;
  const lockedUntil = new Date(lastFailure.at.getTime() + minutesToMs(lockMinutes));

  if (lockedUntil <= now) {
    // The lockout has elapsed; allow another attempt without resetting the counter, so an attacker
    // gains one try per lockout period rather than a fresh allowance of five.
    return {
      allowed: true,
      failuresInWindow: count,
      retryAfterSeconds: 0,
      lockedUntil: null,
      severity: escalated ? 'HARD' : 'SOFT',
    };
  }

  const retryAfterSeconds = Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000);
  return {
    allowed: false,
    failuresInWindow: count,
    retryAfterSeconds,
    lockedUntil,
    severity: escalated ? 'HARD' : 'SOFT',
    message: `Too many sign-in attempts. Try again in ${describeWait(retryAfterSeconds)}, or reset your password.`,
  };
}

function describeWait(seconds: number): string {
  if (seconds < 90) return 'a moment';
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? 'about an hour' : `about ${hours} hours`;
}

/**
 * The single failure message for every credential rejection.
 *
 * One string for "no such user", "wrong password" and "credential login disabled for this account".
 * Distinguishing them is a convenience for the 1% of users who mistyped their email and a gift to
 * anyone testing a leaked address list.
 */
export const GENERIC_LOGIN_FAILURE = 'That email and password combination does not match an account.';

export type CredentialOutcome = 'UNKNOWN_EMAIL' | 'WRONG_PASSWORD' | 'NO_PASSWORD_SET' | 'SUCCESS';

export interface CredentialResponse {
  readonly ok: boolean;
  readonly message?: string;
  /** For audit logs only. Never returned to the client. */
  readonly internalOutcome: CredentialOutcome;
}

export function describeCredentialOutcome(outcome: CredentialOutcome): CredentialResponse {
  if (outcome === 'SUCCESS') return { ok: true, internalOutcome: outcome };
  return { ok: false, message: GENERIC_LOGIN_FAILURE, internalOutcome: outcome };
}

/**
 * Whether a password hash must still be computed even though the user does not exist.
 *
 * Skipping the hash on an unknown email makes that path measurably faster, which turns response time
 * into an existence check. The caller verifies against a dummy hash instead.
 */
export function requiresDummyHashComputation(outcome: CredentialOutcome): boolean {
  return outcome === 'UNKNOWN_EMAIL' || outcome === 'NO_PASSWORD_SET';
}
