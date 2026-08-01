'use client';

/**
 * Sign-in and sign-up form (SCR-001).
 *
 * Client-side validation exists only to spare a round trip; the server validates independently, since
 * anything checked in the browser can be bypassed.
 *
 * The password requirements are shown before submission rather than revealed by rejection. Hiding the
 * rules until failure is a common and needless frustration.
 */

import { useActionState, useState } from 'react';
import { PASSWORD_MIN_LENGTH, validatePassword } from '@/lib/auth/password';
import type { AuthFormState } from '@/app/(auth)/actions';

type Action = (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;

export function AuthForm({
  mode,
  action,
  next,
  notice,
}: {
  mode: 'signin' | 'signup';
  action: Action;
  next?: string;
  /** Explains an involuntary sign-out, e.g. after a session expired. */
  notice?: string;
}) {
  const [state, submit, pending] = useActionState<AuthFormState, FormData>(action, {});
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState(state.email ?? '');

  const verdict = mode === 'signup' && password.length > 0 ? validatePassword(password, email) : null;

  return (
    <form action={submit} className="space-y-5">
      {notice ? (
        <p className="rounded-md border border-[var(--info-line)] bg-[var(--info-bg)] px-4 py-3 text-[var(--info-text)]">
          {notice}
        </p>
      ) : null}

      {state.error ? (
        <div
          role="alert"
          className="rounded-md border border-[var(--warn-line)] bg-[var(--warn-bg)] px-4 py-3 text-[var(--warn-text)]"
        >
          <p className="font-semibold">{state.error}</p>
          {state.fieldErrors && state.fieldErrors.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {state.fieldErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}
          {state.retryAfterSeconds ? (
            <p className="mt-2">
              You can try again in about {Math.ceil(state.retryAfterSeconds / 60)} minute
              {Math.ceil(state.retryAfterSeconds / 60) === 1 ? '' : 's'}.
            </p>
          ) : null}
        </div>
      ) : null}

      {next ? <input type="hidden" name="next" value={next} /> : null}

      {mode === 'signup' ? (
        <Field label="Your name" hint="Optional. Used to name your workspace and to sign your reports.">
          <input
            name="name"
            type="text"
            autoComplete="name"
            className="snsight-input"
          />
        </Field>
      ) : null}

      <Field label="Email">
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="snsight-input"
        />
      </Field>

      <Field
        label="Password"
        hint={mode === 'signup' ? `At least ${PASSWORD_MIN_LENGTH} characters. A short phrase of a few words works well.` : undefined}
      >
        <input
          name="password"
          type="password"
          required
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="snsight-input"
        />
      </Field>

      {verdict ? (
        <div aria-live="polite" className="text-[length:var(--font-small)]">
          {verdict.valid ? (
            <p className="text-[var(--positive-text)]">
              <span aria-hidden="true">&#10003; </span>
              This password meets the requirements. Strength: {verdict.strength.toLowerCase()}.
            </p>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-[var(--text-muted)]">
              {verdict.messages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <button type="submit" disabled={pending} className="snsight-button-primary w-full">
        {pending ? 'Please wait\u2026' : mode === 'signin' ? 'Sign in' : 'Create account'}
      </button>

      {mode === 'signin' ? (
        <p className="text-[length:var(--font-small)] text-[var(--text-muted)]">
          <a href="/forgot-password" className="snsight-link">
            Forgotten your password?
          </a>
        </p>
      ) : null}
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block font-medium text-[var(--text-primary)]">{label}</span>
      {hint ? <span className="mt-1 block text-[length:var(--font-small)] text-[var(--text-muted)]">{hint}</span> : null}
      <span className="mt-2 block">{children}</span>
    </label>
  );
}
