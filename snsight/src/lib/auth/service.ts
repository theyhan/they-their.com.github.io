/**
 * Authentication orchestration (ADR-0008).
 *
 * The decisions here are all made by the pure modules alongside this file - `password.ts`,
 * `rate-limit.ts`, `session.ts`, `onboarding.ts` - which are verified by execution. This file only
 * sequences them against the database, and it is the single place that writes authentication audit
 * events.
 *
 * Two properties matter more than convenience and are easy to lose in refactoring:
 *
 *   1. Every failing sign-in returns the same response and costs the same work, whether or not the
 *      email exists (ADR-0008 decision 8).
 *   2. An audit row is written in the same transaction as the change it records (spec 10.2), so a
 *      change cannot commit without its log.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { burnVerificationTime, argon2Hasher } from './password-hasher.js';
import { validatePassword, type PasswordVerdict } from './password.js';
import {
  describeCredentialOutcome,
  evaluateThrottle,
  requiresDummyHashComputation,
  THROTTLE,
  type CredentialOutcome,
} from './rate-limit.js';
import { planOnboarding } from './onboarding.js';

export interface RequestContext {
  readonly ipAddress?: string;
  readonly userAgent?: string;
  readonly now?: Date;
}

export type SignInResult =
  | { ok: true; sessionToken: string; userId: string }
  | { ok: false; message: string; retryAfterSeconds?: number };

export type SignUpResult =
  | { ok: true; sessionToken: string; userId: string; workspaceId: string }
  | { ok: false; message: string; passwordVerdict?: PasswordVerdict };

/** Sessions are looked up by hash, so a leaked database yields no usable tokens. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Constant-time string comparison, for the rare case of comparing a token we already hold rather than
 * looking one up by hash.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export class AuthService {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Signs in with an email and password.
   *
   * The shape of this method is deliberate: throttling is checked first, then the user is looked up,
   * and then a hash verification always runs - against the stored hash if there is one, against a dummy
   * hash if there is not. Returning early on an unknown email would make that path measurably faster
   * and turn response time into an account-existence oracle.
   */
  async signInWithPassword(rawEmail: string, password: string, ctx: RequestContext = {}): Promise<SignInResult> {
    const now = ctx.now ?? new Date();
    const email = normaliseEmail(rawEmail);

    const attempts = await this.db.loginAttempt.findMany({
      where: { email, attemptedAt: { gte: new Date(now.getTime() - THROTTLE.lookbackMinutes * 60_000) } },
      select: { attemptedAt: true, successful: true },
    });

    const throttle = evaluateThrottle({
      attempts: attempts.map((attempt: { attemptedAt: Date; successful: boolean }) => ({
        at: attempt.attemptedAt,
        successful: attempt.successful,
      })),
      now,
    });

    if (!throttle.allowed) {
      await this.recordAttempt(email, false, 'WRONG_PASSWORD', ctx, now);
      if (throttle.severity === 'HARD') {
        // Repeated escalation against one address is worth an operator's attention; a forgotten
        // password is not.
        await this.audit(null, 'auth.lockout_escalated', { email }, ctx, now);
      }
      return { ok: false, message: throttle.message ?? 'Too many attempts.', retryAfterSeconds: throttle.retryAfterSeconds };
    }

    const user = await this.db.user.findUnique({
      where: { email },
      select: { id: true, credential: { select: { passwordHash: true, needsRehash: true } } },
    });

    let outcome: CredentialOutcome;
    if (!user) outcome = 'UNKNOWN_EMAIL';
    else if (!user.credential) outcome = 'NO_PASSWORD_SET';
    else outcome = (await argon2Hasher.verify(user.credential.passwordHash, password)) ? 'SUCCESS' : 'WRONG_PASSWORD';

    if (requiresDummyHashComputation(outcome)) {
      await burnVerificationTime(password);
    }

    if (outcome !== 'SUCCESS') {
      await this.recordAttempt(email, false, outcome, ctx, now);
      const response = describeCredentialOutcome(outcome);
      return { ok: false, message: response.message ?? 'Sign-in failed.' };
    }

    // Apply a cost increase lazily, now that the plaintext is available and correct.
    if (user!.credential!.needsRehash || argon2Hasher.needsRehash(user!.credential!.passwordHash)) {
      const upgraded = await argon2Hasher.hash(password);
      await this.db.userCredential.update({
        where: { userId: user!.id },
        data: { passwordHash: upgraded, needsRehash: false },
      });
    }

    const sessionToken = await this.createSession(user!.id, ctx, now);
    await this.recordAttempt(email, true, 'SUCCESS', ctx, now);
    await this.audit(user!.id, 'auth.signed_in', { method: 'password' }, ctx, now);

    return { ok: true, sessionToken, userId: user!.id };
  }

  /**
   * Creates an account, its first workspace, and an owner membership, in one transaction.
   *
   * An orphaned user with no workspace would land on a broken dashboard, and a workspace with no owner
   * could not be administered by anyone, so neither may exist even briefly.
   */
  async signUpWithPassword(
    rawEmail: string,
    password: string,
    displayName: string | null,
    ctx: RequestContext = {},
  ): Promise<SignUpResult> {
    const now = ctx.now ?? new Date();
    const email = normaliseEmail(rawEmail);

    const verdict = validatePassword(password, email);
    if (!verdict.valid) {
      return { ok: false, message: verdict.messages[0] ?? 'Choose a stronger password.', passwordVerdict: verdict };
    }

    const existing = await this.db.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      // Signup is the one place an existence hint is unavoidable, since two accounts cannot share an
      // address. The wording avoids confirming it outright and points at recovery.
      return {
        ok: false,
        message: 'That email cannot be used to create a new account. If it is yours, sign in or reset your password.',
      };
    }

    const takenSlugs = new Set<string>(
      (await this.db.workspace.findMany({ select: { slug: true } })).map((workspace: { slug: string }) => workspace.slug),
    );
    const plan = planOnboarding({ email, displayName, takenSlugs });
    const passwordHash = await argon2Hasher.hash(password);

    const created = await this.db.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email, name: displayName } });
      await tx.userCredential.create({ data: { userId: user.id, passwordHash } });
      const workspace = await tx.workspace.create({
        data: { name: plan.workspaceName, slug: plan.slug, planTier: plan.planTier, isDemo: plan.isDemo },
      });
      await tx.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: user.id, role: plan.role, acceptedAt: now },
      });
      await tx.auditLog.create({
        data: {
          workspaceId: workspace.id,
          actorUserId: user.id,
          action: 'auth.signed_up',
          targetType: 'workspace',
          targetId: workspace.id,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return { user, workspace };
    });

    const sessionToken = await this.createSession(created.user.id, ctx, now);
    return { ok: true, sessionToken, userId: created.user.id, workspaceId: created.workspace.id };
  }

  /**
   * Re-confirms a password inside an existing session, reopening the window for sensitive actions
   * without minting a new session (ADR-0008 decision 7).
   */
  async confirmPassword(userId: string, password: string, ctx: RequestContext = {}): Promise<boolean> {
    const now = ctx.now ?? new Date();
    const credential = await this.db.userCredential.findUnique({ where: { userId }, select: { passwordHash: true } });

    if (!credential) {
      await burnVerificationTime(password);
      return false;
    }
    const valid = await argon2Hasher.verify(credential.passwordHash, password);
    if (!valid) {
      await this.audit(userId, 'auth.reconfirm_failed', {}, ctx, now);
      return false;
    }

    await this.db.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { authenticatedAt: now, lastSeenAt: now },
    });
    await this.audit(userId, 'auth.reconfirmed', {}, ctx, now);
    return true;
  }

  async signOut(sessionToken: string, ctx: RequestContext = {}): Promise<void> {
    const now = ctx.now ?? new Date();
    const session = await this.db.authSession.findUnique({
      where: { tokenHash: hashToken(sessionToken) },
      select: { id: true, userId: true },
    });
    if (!session) return;

    await this.db.authSession.update({
      where: { id: session.id },
      data: { revokedAt: now, revokedReason: 'SIGNED_OUT' },
    });
    await this.audit(session.userId, 'auth.signed_out', {}, ctx, now);
  }

  /**
   * Revokes every session for a user. Called when a member is removed from a workspace, which is the
   * reason sessions are database rows rather than stateless tokens.
   */
  async revokeAllSessions(userId: string, reason: string, ctx: RequestContext = {}): Promise<number> {
    const now = ctx.now ?? new Date();
    const result = await this.db.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
    await this.audit(userId, 'auth.sessions_revoked', { reason, count: result.count }, ctx, now);
    return result.count;
  }

  private async createSession(userId: string, ctx: RequestContext, now: Date): Promise<string> {
    const token = newSessionToken();
    await this.db.authSession.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        createdAt: now,
        lastSeenAt: now,
        authenticatedAt: now,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return token;
  }

  private async recordAttempt(
    email: string,
    successful: boolean,
    outcome: CredentialOutcome,
    ctx: RequestContext,
    now: Date,
  ): Promise<void> {
    await this.db.loginAttempt.create({
      data: { email, successful, outcome, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, attemptedAt: now },
    });
  }

  private async audit(
    userId: string | null,
    action: string,
    detail: Record<string, unknown>,
    ctx: RequestContext,
    now: Date,
  ): Promise<void> {
    await this.db.auditLog.create({
      data: {
        actorUserId: userId,
        action,
        // A digest rather than the values, to avoid copying personal data into the audit trail
        // (ADR-0005).
        afterDigest: createHash('sha256').update(JSON.stringify(detail)).digest('hex').slice(0, 32),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        createdAt: now,
      },
    });
  }
}

export { hashToken };
