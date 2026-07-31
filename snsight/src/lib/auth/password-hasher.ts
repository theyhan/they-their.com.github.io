/**
 * argon2id implementation of `PasswordHasher`.
 *
 * Isolated in its own file because argon2 is a native module: keeping it here lets the policy in
 * `password.ts` stay pure and testable without it.
 */

import argon2 from 'argon2';
import { ARGON2_PARAMETERS, type PasswordHasher } from './password.js';

const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: ARGON2_PARAMETERS.memoryCostKiB,
  timeCost: ARGON2_PARAMETERS.timeCost,
  parallelism: ARGON2_PARAMETERS.parallelism,
} as const;

/**
 * Verified against on an unknown email so that the response time of a failed sign-in does not reveal
 * whether the account exists (ADR-0008 decision 8). Generated once at module load from a random value
 * that is then discarded, so no password matches it.
 */
let dummyHashPromise: Promise<string> | null = null;

function dummyHash(): Promise<string> {
  dummyHashPromise ??= argon2.hash(`unused-${Math.random()}-${Date.now()}`, OPTIONS);
  return dummyHashPromise;
}

export const argon2Hasher: PasswordHasher = {
  async hash(password: string): Promise<string> {
    return argon2.hash(password, OPTIONS);
  },

  async verify(storedHash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(storedHash, password);
    } catch {
      // A malformed stored hash must fail closed, not throw into the request handler.
      return false;
    }
  },

  needsRehash(storedHash: string): boolean {
    // The encoded hash carries its parameters, so an increase in cost can be applied lazily on the
    // next successful sign-in rather than by a migration that needs everyone's password.
    const memoryMatch = /m=(\d+)/.exec(storedHash);
    const timeMatch = /t=(\d+)/.exec(storedHash);
    if (!storedHash.startsWith('$argon2id$')) return true;
    if (!memoryMatch || !timeMatch) return true;
    return (
      Number(memoryMatch[1]) < ARGON2_PARAMETERS.memoryCostKiB || Number(timeMatch[1]) < ARGON2_PARAMETERS.timeCost
    );
  },
};

/** Burns the equivalent work of a real verification. Used when there is no hash to check. */
export async function burnVerificationTime(password: string): Promise<void> {
  const hash = await dummyHash();
  await argon2.verify(hash, password).catch(() => false);
}
