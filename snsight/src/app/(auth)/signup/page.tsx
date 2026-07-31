import { AuthForm } from '@/components/auth/AuthForm';
import { signUpAction } from '../actions';

export const metadata = { title: 'Create an account - SNSight' };

export default function SignUpPage() {
  return (
    <>
      <h1 className="text-[length:var(--font-h1)] font-semibold text-[var(--text-primary)]">Create your account</h1>
      <p className="mt-2 text-[var(--text-secondary)]">
        Already have one?{' '}
        <a href="/login" className="snsight-link">
          Sign in
        </a>
        .
      </p>

      <div className="mt-6">
        <AuthForm mode="signup" action={signUpAction} />
      </div>

      <div className="mt-6 border-t border-[var(--line-default)] pt-4 text-[length:var(--font-small)] text-[var(--text-muted)]">
        <p>
          You will get a personal workspace on the free plan: one connected account, 30 days of history,
          and three account analyses a day. No card required, and nothing is charged automatically.
        </p>
        <p className="mt-2">
          By creating an account you accept the{' '}
          <a href="/terms" className="snsight-link">
            terms
          </a>{' '}
          and the{' '}
          <a href="/privacy" className="snsight-link">
            privacy notice
          </a>
          , which explains what we collect from connected platforms and who processes it.
        </p>
      </div>
    </>
  );
}
