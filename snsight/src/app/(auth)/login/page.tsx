import { AuthForm } from '@/components/auth/AuthForm';
import { signInAction } from '../actions';

export const metadata = { title: 'Sign in - SNSight' };

/**
 * `reason` explains an involuntary sign-out. Without it, an expired session looks like the product
 * forgetting the user for no reason, and the usual reaction is to doubt the product rather than to
 * sign in again.
 */
const REASON_NOTICE: Record<string, string> = {
  expired: 'Your session expired. Please sign in again.',
  idle: 'You were signed out after a period of inactivity.',
  revoked: 'You were signed out because your access to a workspace changed.',
  'signed-out': 'You have been signed out.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string; reason?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const notice = params.reason ? REASON_NOTICE[params.reason] : undefined;

  return (
    <>
      <h1 className="text-[length:var(--font-h1)] font-semibold text-[var(--text-primary)]">Sign in to SNSight</h1>
      <p className="mt-2 text-[var(--text-secondary)]">
        New here?{' '}
        <a href="/signup" className="snsight-link">
          Create an account
        </a>
        .
      </p>

      <div className="mt-6">
        <AuthForm mode="signin" action={signInAction} next={params.next} notice={notice} />
      </div>

      <p className="mt-6 border-t border-[var(--line-default)] pt-4 text-[length:var(--font-small)] text-[var(--text-muted)]">
        Want to look first?{' '}
        <a href="/demo" className="snsight-link">
          Open the sample dashboard
        </a>{' '}
        &mdash; no account needed.
      </p>
    </>
  );
}
