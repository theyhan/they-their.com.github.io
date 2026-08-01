'use server';

/**
 * Authentication server actions.
 *
 * Thin by design: every decision belongs to `AuthService` and the pure modules it calls. What these do
 * add is the cookie and the redirect, plus the rule that a failure never says more than the generic
 * message (ADR-0008 decision 8).
 */

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { AuthService } from '@/lib/auth/service';
import { SESSION, SESSION_COOKIE } from '@/lib/auth/session';
import { validatePassword } from '@/lib/auth/password';

export interface AuthFormState {
  readonly error?: string;
  readonly fieldErrors?: readonly string[];
  readonly retryAfterSeconds?: number;
  /** Preserved so a failed submission does not clear the field the user typed correctly. */
  readonly email?: string;
}

async function requestContext(): Promise<{ ipAddress?: string; userAgent?: string }> {
  const list = await headers();
  // Behind a proxy the client address is the first entry of the forwarded chain; the socket address
  // would be the proxy itself and would throttle every user as one.
  const forwarded = list.get('x-forwarded-for');
  return {
    ipAddress: forwarded?.split(',')[0]?.trim() ?? list.get('x-real-ip') ?? undefined,
    userAgent: list.get('user-agent') ?? undefined,
  };
}

async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE.name, token, {
    httpOnly: SESSION_COOKIE.httpOnly,
    sameSite: SESSION_COOKIE.sameSite,
    path: SESSION_COOKIE.path,
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION.absoluteMaxDays * 86_400,
  });
}

/** Only relative paths are honoured, so `?next=` cannot be used as an open redirect. */
function safeNext(raw: FormDataEntryValue | null): string {
  const value = typeof raw === 'string' ? raw : '';
  if (!value.startsWith('/') || value.startsWith('//')) return '/dashboard';
  return value;
}

export async function signInAction(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const next = safeNext(formData.get('next'));

  if (email.trim().length === 0 || password.length === 0) {
    return { error: 'Enter your email and password.', email };
  }

  const service = new AuthService(db);
  const result = await service.signInWithPassword(email, password, await requestContext());

  if (!result.ok) {
    return { error: result.message, retryAfterSeconds: result.retryAfterSeconds, email };
  }

  await setSessionCookie(result.sessionToken);
  redirect(next);
}

export async function signUpAction(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const name = String(formData.get('name') ?? '').trim();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
    return { error: 'Enter a valid email address.', email };
  }

  const verdict = validatePassword(password, email);
  if (!verdict.valid) {
    return { error: 'Choose a different password.', fieldErrors: verdict.messages, email };
  }

  const service = new AuthService(db);
  const result = await service.signUpWithPassword(email, password, name.length > 0 ? name : null, await requestContext());

  if (!result.ok) {
    return { error: result.message, fieldErrors: result.passwordVerdict?.messages, email };
  }

  await setSessionCookie(result.sessionToken);
  // Straight to the dashboard, which shows the demo state and the prompt to connect an account
  // (ADR-0008 consequences). A separate "welcome" page would be a wall between the user and the product.
  redirect('/dashboard');
}

export async function signOutAction(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE.name)?.value;
  if (token) {
    await new AuthService(db).signOut(token, await requestContext());
  }
  store.delete(SESSION_COOKIE.name);
  redirect('/login');
}
