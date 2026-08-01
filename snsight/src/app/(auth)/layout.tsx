/**
 * Auth screens (SCR-001).
 *
 * Two columns on a wide viewport: the form, and the value proposition the specification asks for. On a
 * narrow viewport the form comes first, because someone arriving to sign in should not have to scroll
 * past marketing copy to reach the field.
 */

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto grid max-w-5xl gap-10 px-5 py-12 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:py-20">
      <div className="rounded-xl border border-[var(--line-default)] bg-[var(--surface-card)] p-6 shadow-sm sm:p-8">
        {children}
      </div>

      <aside className="text-[var(--text-secondary)] lg:pt-2">
        <h2 className="text-[length:var(--font-body)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          What SNSight does
        </h2>
        <ul className="mt-4 space-y-4">
          <Point title="Instagram and Threads in one view">
            Common metrics side by side, plus the ones only one platform reports. Figures that measure
            different things are never added together.
          </Point>
          <Point title="Every number is traceable">
            Each metric says whether it came from the platform, was calculated, or is an estimate, and
            every figure opens the posts behind it.
          </Point>
          <Point title="Analysis that shows its evidence">
            AI summaries cite the posts they rest on, state the period analysed, and carry a confidence
            level calculated from how much data exists.
          </Point>
        </ul>

        <p className="mt-8 rounded-md border border-[var(--info-line)] bg-[var(--info-bg)] px-4 py-3 text-[var(--info-text)]">
          <strong className="font-semibold">Signing in does not connect an account.</strong> Creating an
          SNSight account is separate from granting access to your Instagram or Threads data. You will be
          asked for that afterwards, and you can look around the sample dashboard first.
        </p>
      </aside>
    </main>
  );
}

function Point({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li>
      <h3 className="font-semibold text-[var(--text-primary)]">{title}</h3>
      <p className="mt-1">{children}</p>
    </li>
  );
}
