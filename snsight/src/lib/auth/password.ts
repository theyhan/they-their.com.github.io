/**
 * Password policy (ADR-0008 decision 9).
 *
 * Follows current guidance rather than folklore: length is the requirement, composition rules are not.
 * Mandating an uppercase letter and a symbol reliably produces `Password1!` and a sticky note, which is
 * worse than a long passphrase.
 *
 * Hashing is behind an interface because argon2 is a native dependency; the policy here is pure and
 * verified by execution.
 */

export const PASSWORD_MIN_LENGTH = 12;
/** Bounded to keep hashing cost predictable: an unbounded input is a denial-of-service vector. */
export const PASSWORD_MAX_LENGTH = 128;

/**
 * A deliberately small sample. In production this check runs against a breached-password corpus such as
 * Pwned Passwords, queried by hash prefix so the password never leaves the server. The list here exists
 * so the rule is testable offline, and is not a substitute for that.
 */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  'password',
  'password1',
  'password123',
  'passw0rd',
  '123456',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty',
  'qwertyuiop',
  'letmein',
  'welcome',
  'welcome1',
  'admin',
  'administrator',
  'iloveyou',
  'monkey',
  'dragon',
  'football',
  'baseball',
  'sunshine',
  'princess',
  'trustno1',
  'changeme',
  'snsight',
  'instagram',
  'threads',
  'correcthorsebatterystaple',
]);

export type PasswordProblem =
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'COMMON'
  | 'CONTAINS_EMAIL'
  | 'REPEATED_CHARACTER'
  | 'SEQUENTIAL'
  | 'WHITESPACE_ONLY';

export interface PasswordVerdict {
  readonly valid: boolean;
  readonly problems: readonly PasswordProblem[];
  /** Shown beneath the field, one sentence per problem. */
  readonly messages: readonly string[];
  /** Advisory only. Never gates submission, so a strong unusual password is not rejected. */
  readonly strength: 'WEAK' | 'FAIR' | 'STRONG';
}

const MESSAGES: Record<PasswordProblem, string> = {
  TOO_SHORT: `Use at least ${PASSWORD_MIN_LENGTH} characters. A short phrase of a few words works well.`,
  TOO_LONG: `Keep it under ${PASSWORD_MAX_LENGTH} characters.`,
  COMMON: 'This password appears in lists of commonly used passwords. Choose something less predictable.',
  CONTAINS_EMAIL: 'Do not include your email address in your password.',
  REPEATED_CHARACTER: 'Avoid repeating a single character. Length alone does not help if it is all one letter.',
  SEQUENTIAL: 'Avoid keyboard runs and number sequences such as 123456 or qwerty.',
  WHITESPACE_ONLY: 'Enter a password.',
};

function hasLongRun(value: string): boolean {
  // Four or more of the same character in a row, e.g. `aaaa`.
  let run = 1;
  for (let i = 1; i < value.length; i += 1) {
    if (value[i] === value[i - 1]) {
      run += 1;
      if (run >= 4) return true;
    } else {
      run = 1;
    }
  }
  return false;
}

function hasSequentialRun(value: string): boolean {
  const lower = value.toLowerCase();
  const runs = ['abcdefghijklmnopqrstuvwxyz', '01234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  for (const run of runs) {
    for (let i = 0; i + 5 <= run.length; i += 1) {
      const window = run.slice(i, i + 5);
      if (lower.includes(window)) return true;
      const reversed = [...window].reverse().join('');
      if (lower.includes(reversed)) return true;
    }
  }
  return false;
}

/** Rough character-class entropy, for the advisory meter only. */
function estimateStrength(password: string): PasswordVerdict['strength'] {
  const classes =
    (/[a-z]/.test(password) ? 26 : 0) +
    (/[A-Z]/.test(password) ? 26 : 0) +
    (/[0-9]/.test(password) ? 10 : 0) +
    (/[^a-zA-Z0-9]/.test(password) ? 33 : 0);
  const distinct = new Set(password).size;
  const bits = password.length * Math.log2(Math.max(classes, distinct, 2));

  if (bits >= 80) return 'STRONG';
  if (bits >= 60) return 'FAIR';
  return 'WEAK';
}

export function validatePassword(password: string, email?: string): PasswordVerdict {
  const problems: PasswordProblem[] = [];

  if (password.trim().length === 0) {
    problems.push('WHITESPACE_ONLY');
  } else {
    // Minimum length is measured on the trimmed string, or `abc` followed by nine spaces would pass a
    // twelve-character rule with three characters of actual entropy. Spaces inside a passphrase still
    // count, which is the point of allowing them.
    if (password.trim().length < PASSWORD_MIN_LENGTH) problems.push('TOO_SHORT');
    // Maximum is measured raw, since the server must hash exactly what it received.
    if (password.length > PASSWORD_MAX_LENGTH) problems.push('TOO_LONG');

    const normalised = password.toLowerCase();
    if (COMMON_PASSWORDS.has(normalised)) problems.push('COMMON');

    if (email) {
      const localPart = email.split('@')[0]?.toLowerCase() ?? '';
      // Only meaningful for a local part long enough to matter; `a@x.com` would match everything.
      if (localPart.length >= 3 && normalised.includes(localPart)) problems.push('CONTAINS_EMAIL');
    }

    if (hasLongRun(password)) problems.push('REPEATED_CHARACTER');
    if (hasSequentialRun(password)) problems.push('SEQUENTIAL');
  }

  return {
    valid: problems.length === 0,
    problems,
    messages: problems.map((problem) => MESSAGES[problem]),
    strength: estimateStrength(password),
  };
}

/**
 * Hashing boundary. Implemented with argon2id in `password-hasher.ts`; kept behind an interface so the
 * policy above stays testable without a native module, and so the algorithm can be replaced without
 * touching call sites.
 */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  /** Must be constant-time with respect to the password, which argon2's verify provides. */
  verify(storedHash: string, password: string): Promise<boolean>;
  /** True when the stored hash used weaker parameters and should be upgraded on next sign-in. */
  needsRehash(storedHash: string): boolean;
}

/** Argon2id parameters. Recorded here so a change is a visible, reviewable diff. */
export const ARGON2_PARAMETERS = {
  type: 'argon2id',
  memoryCostKiB: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;
