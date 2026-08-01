/**
 * Resolves the signed-in user for a request.
 *
 * Every authenticated page and action starts here. It returns the member record - including role and
 * account scope - because authorisation needs all three, and fetching them separately invites a check
 * that uses a stale role.
 */

import { cookies } from 'next/headers';
import type { PrismaClient } from '@prisma/client';
import { hashToken } from './service.js';
import { evaluateSession, SESSION_COOKIE, type SessionEvaluation } from './session.js';
import type { Member, WorkspaceRole } from './permissions.js';

export interface CurrentUser {
  readonly userId: string;
  readonly email: string;
  readonly name: string | null;
  readonly session: SessionEvaluation;
  /** The active workspace membership. Null when the user belongs to no workspace, which onboarding fixes. */
  readonly member: Member | null;
  readonly workspaceName: string | null;
  readonly planTier: 'FREE' | 'PRO' | 'AGENCY' | null;
}

export type AuthState =
  | { authenticated: true; user: CurrentUser }
  | { authenticated: false; reason: 'NO_COOKIE' | 'NO_SESSION' | 'SESSION_ENDED'; message?: string };

/**
 * Reads and validates the session.
 *
 * An expired or revoked session returns a reason and a message, so the login screen can explain the
 * sign-out rather than appearing to have forgotten the user for no reason.
 */
export async function getAuthState(db: PrismaClient, workspaceSlug?: string): Promise<AuthState> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE.name)?.value;
  if (!token) return { authenticated: false, reason: 'NO_COOKIE' };

  const record = await db.authSession.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      createdAt: true,
      lastSeenAt: true,
      authenticatedAt: true,
      revokedAt: true,
      userId: true,
      user: {
        select: {
          email: true,
          name: true,
          memberships: {
            select: {
              workspaceId: true,
              role: true,
              accountScope: true,
              workspace: { select: { name: true, slug: true, planTier: true, deletedAt: true } },
            },
          },
        },
      },
    },
  });

  if (!record) return { authenticated: false, reason: 'NO_SESSION' };

  const now = new Date();
  const session = evaluateSession(record, now);
  if (!session.active) {
    return { authenticated: false, reason: 'SESSION_ENDED', message: session.message };
  }

  if (session.shouldRefresh) {
    // Fire and forget: a failed activity write must not fail the request.
    void db.authSession.update({ where: { tokenHash: hashToken(token) }, data: { lastSeenAt: now } }).catch(() => undefined);
  }

  // Named locally rather than relying on inference, so the shape this function depends on is visible
  // and a change to the query above becomes a type error here.
  interface MembershipRow {
    workspaceId: string;
    role: string;
    accountScope: string[];
    workspace: { name: string; slug: string; planTier: string; deletedAt: Date | null };
  }

  const memberships: MembershipRow[] = record.user.memberships.filter(
    (membership: MembershipRow) => membership.workspace.deletedAt === null,
  );
  const selected =
    (workspaceSlug
      ? memberships.find((membership: MembershipRow) => membership.workspace.slug === workspaceSlug)
      : undefined) ?? memberships[0];

  const member: Member | null = selected
    ? {
        userId: record.userId,
        workspaceId: selected.workspaceId,
        role: selected.role as WorkspaceRole,
        accountScope: selected.accountScope,
      }
    : null;

  return {
    authenticated: true,
    user: {
      userId: record.userId,
      email: record.user.email,
      name: record.user.name,
      session,
      member,
      workspaceName: selected?.workspace.name ?? null,
      planTier: (selected?.workspace.planTier as CurrentUser['planTier']) ?? null,
    },
  };
}

/**
 * For server actions that must have a user. Throws rather than returning null, so a missing check is a
 * failed request instead of an action running with `undefined` as the actor.
 */
export async function requireUser(db: PrismaClient, workspaceSlug?: string): Promise<CurrentUser> {
  const state = await getAuthState(db, workspaceSlug);
  if (!state.authenticated) throw new Error('UNAUTHENTICATED');
  return state.user;
}
