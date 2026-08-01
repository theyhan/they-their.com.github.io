/**
 * Provider error translation (spec FR-002, 10.3, acceptance criterion 8).
 *
 * "Token expiration, missing permissions, and API restrictions produce recoverable guidance" means
 * every provider failure must arrive at the UI as a sentence plus a next step, and at the queue as
 * a retry decision. Both come from this one table so the two cannot disagree.
 *
 * Status: the numeric codes are Meta's documented subcodes. They must be confirmed against live
 * responses before Phase 1 exit (ADR-0002 confirming check); unrecognised codes fall through to a
 * conservative default rather than being treated as success.
 */

import type { ProviderError } from './types.js';

export type ErrorClass =
  | 'TOKEN_EXPIRED'
  | 'TOKEN_REVOKED'
  | 'INSUFFICIENT_SCOPE'
  | 'RATE_LIMITED'
  | 'METRIC_UNAVAILABLE'
  | 'TARGET_NOT_ELIGIBLE'
  | 'TRANSIENT'
  | 'UNKNOWN';

interface RawProviderFailure {
  httpStatus?: number;
  /** Meta `error.code`. */
  code?: number;
  /** Meta `error.error_subcode`. */
  subcode?: number;
  message?: string;
  /** Seconds from a `Retry-After` header, when present. */
  retryAfterSeconds?: number;
}

/** Backoff schedule for retryable failures (spec 10.3). Capped so a job cannot stall forever. */
export function backoffSeconds(attempt: number): number {
  const base = Math.min(2 ** attempt * 30, 3600);
  // Deterministic jitter by attempt number keeps retries from synchronising across accounts while
  // remaining reproducible in tests.
  const jitter = (attempt * 7) % 30;
  return base + jitter;
}

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);
const PERMISSION_CODES = new Set([10, 200, 203]);

export function classify(failure: RawProviderFailure): ErrorClass {
  const { code, subcode, httpStatus } = failure;

  if (code === 190) {
    // 458 user has de-authorised, 460 password changed, 463 expired, 467 invalid.
    if (subcode === 458 || subcode === 460) return 'TOKEN_REVOKED';
    return 'TOKEN_EXPIRED';
  }
  if (code !== undefined && RATE_LIMIT_CODES.has(code)) return 'RATE_LIMITED';
  if (code !== undefined && PERMISSION_CODES.has(code)) return 'INSUFFICIENT_SCOPE';
  if (code === 100) {
    // Also returned when a metric no longer exists on the requested API version, which is a
    // configuration problem rather than a user problem.
    return 'METRIC_UNAVAILABLE';
  }
  if (code === 24 || code === 110) return 'TARGET_NOT_ELIGIBLE';
  if (httpStatus !== undefined && httpStatus >= 500) return 'TRANSIENT';
  if (httpStatus === 429) return 'RATE_LIMITED';
  return 'UNKNOWN';
}

/**
 * Produces the user-facing error. Note that a rate limit is not presented as a failure: the data
 * is fine, it is merely late, and telling a user their account is broken because of our queue
 * pressure would be wrong.
 */
export function toProviderError(failure: RawProviderFailure): ProviderError {
  const kind = classify(failure);
  const diagnostic = [
    failure.httpStatus !== undefined ? `http=${failure.httpStatus}` : null,
    failure.code !== undefined ? `code=${failure.code}` : null,
    failure.subcode !== undefined ? `subcode=${failure.subcode}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' ');

  switch (kind) {
    case 'TOKEN_EXPIRED':
      return {
        code: 'TOKEN_EXPIRED',
        userMessage: 'The connection to this account has expired, so new data is not being collected.',
        userAction: 'Reconnect the account to resume collection. Data already collected is unaffected.',
        isRetryable: false,
        connectionStatus: 'EXPIRED',
        diagnostic,
      };
    case 'TOKEN_REVOKED':
      return {
        code: 'TOKEN_REVOKED',
        userMessage: 'Access to this account was withdrawn on the platform side.',
        userAction: 'Reconnect and approve access again. If you did not withdraw it, check the account password.',
        isRetryable: false,
        connectionStatus: 'REVOKED',
        diagnostic,
      };
    case 'INSUFFICIENT_SCOPE':
      return {
        code: 'INSUFFICIENT_SCOPE',
        userMessage: 'This account has not granted the permission needed for these metrics.',
        userAction: 'Reconnect the account and approve the insights permission. Other metrics keep updating meanwhile.',
        isRetryable: false,
        connectionStatus: 'INSUFFICIENT_SCOPE',
        diagnostic,
      };
    case 'RATE_LIMITED':
      return {
        code: 'RATE_LIMITED',
        userMessage: 'The platform is limiting how often we can request data, so this update is queued.',
        userAction: 'No action needed. Collection resumes automatically and the dashboard shows the last successful sync.',
        isRetryable: true,
        retryAfterSeconds: failure.retryAfterSeconds ?? 900,
        connectionStatus: 'RATE_LIMITED',
        diagnostic,
      };
    case 'METRIC_UNAVAILABLE':
      return {
        code: 'METRIC_UNAVAILABLE',
        userMessage: 'The platform no longer provides one of the metrics this view requested.',
        userAction: 'The metric definition shows the period it was available. Other metrics are unaffected.',
        isRetryable: false,
        diagnostic,
      };
    case 'TARGET_NOT_ELIGIBLE':
      return {
        code: 'TARGET_NOT_ELIGIBLE',
        userMessage: 'This account cannot be analysed from public data.',
        userAction: 'Only public Instagram Business or Creator accounts can be analysed. Connect the account directly if you own it.',
        isRetryable: false,
        diagnostic,
      };
    case 'TRANSIENT':
      return {
        code: 'TRANSIENT_PLATFORM_ERROR',
        userMessage: 'The platform did not respond successfully. This is usually temporary.',
        userAction: 'The update will be retried automatically.',
        isRetryable: true,
        retryAfterSeconds: failure.retryAfterSeconds ?? 60,
        diagnostic,
      };
    default:
      // Deliberately retryable-once rather than silently swallowed: an unmapped code is a gap in
      // this table, and it should surface as a visible sync error we can find in the logs.
      return {
        code: 'UNMAPPED_PROVIDER_ERROR',
        userMessage: 'Something went wrong while collecting data from the platform.',
        userAction: 'The update will be retried. If it keeps failing, contact support with the sync log reference.',
        isRetryable: true,
        retryAfterSeconds: 300,
        diagnostic: `${diagnostic} raw=${failure.message ?? 'none'}`,
      };
  }
}

/** Guard for ADR-0001: a Threads competitor request must never reach a network call. */
export function threadsCompetitorUnsupported(): ProviderError {
  return {
    code: 'NO_OFFICIAL_SOURCE',
    userMessage: 'Threads does not offer an API for analysing accounts you do not own, so no metrics can be shown here.',
    userAction: 'Keep this account as a reference link, or connect it directly if you own it.',
    isRetryable: false,
  };
}
