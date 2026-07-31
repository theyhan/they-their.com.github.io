/**
 * Unified dashboard route (SCR-002).
 *
 * A server component: it loads data, builds the view model, and hands finished figures to the client
 * shell. No metric is computed in the browser, and per ADR-0006 no model call happens in this
 * request - the AI panel renders whatever the background job has already produced.
 */

import { buildAllContentRows, buildDashboard } from '@/lib/dashboard/build';
import { loadFixtureDashboard } from '@/lib/dashboard/fixture-loader';
import { resolveProviderMode } from '@/lib/platform';
import { DashboardClient } from '@/components/dashboard/DashboardClient';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ days?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const periodDays = parsePeriod(params.days);
  const mode = resolveProviderMode(process.env.SNSIGHT_PROVIDER);

  if (mode !== 'fixture') {
    // Live adapters are gated on Meta App Review (ADR-0002). Failing loudly is correct: an empty
    // dashboard would be indistinguishable from an account with no activity.
    throw new Error('Live provider mode is not implemented yet. Set SNSIGHT_PROVIDER=fixture.');
  }

  const asOf = process.env.SNSIGHT_FIXTURE_AS_OF
    ? new Date(`${process.env.SNSIGHT_FIXTURE_AS_OF}T00:00:00Z`)
    : new Date();

  const input = await loadFixtureDashboard({
    asOf,
    periodDays,
    seed: process.env.SNSIGHT_FIXTURE_SEED ?? 'demo',
  });

  const model = buildDashboard(input);
  const rows = buildAllContentRows(input);

  return <DashboardClient model={model} rows={rows} />;
}

/** FR-003 offers 7, 30 and 90 days plus custom; anything unrecognised falls back to 30. */
function parsePeriod(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 365) return 30;
  return parsed;
}
