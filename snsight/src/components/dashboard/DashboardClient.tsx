'use client';

/**
 * Interactive shell for the unified dashboard (SCR-002).
 *
 * Drill-down state lives here; the figures themselves arrive fully resolved from the server. The
 * modal calls `resolveDrilldown` with the same reference the card carries, so what the card claims
 * and what the modal shows cannot diverge.
 */

import { useMemo, useState } from 'react';
import { resolveDrilldown, SORT_LABELS } from '@/lib/dashboard/drilldown';
import type { ContentRow, ContentSort, DashboardViewModel, DrilldownRef, KpiCard } from '@/lib/dashboard/types';
import { ContentList } from './ContentList';
import { EmptyState } from './primitives';
import { KpiCardView } from './KpiCardView';
import { TrendChart } from './TrendChart';

interface OpenDrilldown {
  ref: DrilldownRef;
  onDate?: string;
}

export function DashboardClient({ model, rows }: { model: DashboardViewModel; rows: ContentRow[] }) {
  const [open, setOpen] = useState<OpenDrilldown | null>(null);
  const [sort, setSort] = useState<ContentSort | null>(null);

  const result = useMemo(() => {
    if (!open) return null;
    return resolveDrilldown({ ref: open.ref, rows, onDate: open.onDate, sortOverride: sort ?? undefined });
  }, [open, rows, sort]);

  const openCard = (card: KpiCard): void => {
    if (!card.drilldown) return;
    setSort(null);
    setOpen({ ref: card.drilldown });
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <Header model={model} />

      <section aria-labelledby="common-kpis" className="mt-6">
        <h2 id="common-kpis" className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Across platforms
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {model.commonKpis.map((card) => (
            <KpiCardView key={card.id} card={card} onDrilldown={openCard} />
          ))}
        </div>
      </section>

      {model.platformSections.map((section) => (
        <section key={section.platform} aria-labelledby={`section-${section.platform}`} className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id={`section-${section.platform}`} className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {section.platform === 'INSTAGRAM' ? 'Instagram' : 'Threads'}
            </h2>
            <p className="text-xs text-slate-600">{section.connectionStatusText}</p>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {section.kpis.map((card) => (
              <KpiCardView key={card.id} card={card} onDrilldown={openCard} />
            ))}
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <TrendChart
              series={section.trend}
              onSelectDate={(date) => {
                setSort(null);
                setOpen({ ref: section.kpis[0]!.drilldown!, onDate: date });
              }}
            />
            <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-600">
              {section.contribution.postCount} posts, {section.contribution.postSharePercent}% of everything published
              in this period. {section.contribution.nativeInteractionsNote}
            </p>
            {section.coverageNotice ? <p className="mt-2 text-xs text-slate-700">{section.coverageNotice}</p> : null}
          </div>
        </section>
      ))}

      <section aria-labelledby="ranking" className="mt-8 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 id="ranking" className="text-sm font-semibold text-slate-800">
            Best performing
          </h2>
          <ContentList rows={model.bestContent} emptyMessage="No post has enough comparable content to be ranked yet." />
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-800">Weakest performing</h2>
          <ContentList rows={model.worstContent} emptyMessage="No post has enough comparable content to be ranked yet." />
        </div>
        <p className="text-xs leading-relaxed text-slate-600 lg:col-span-2">{model.rankingNote}</p>
      </section>

      <AiPanel model={model} />
      <NextActions model={model} />

      {open && result ? (
        <DrilldownModal
          title={result.title}
          description={result.description}
          filters={result.appliedFilters}
          sort={result.sort}
          onSort={setSort}
          onClose={() => setOpen(null)}
        >
          {result.emptyState ? (
            <EmptyState reason={result.emptyState.reason} action={result.emptyState.action} />
          ) : (
            <ContentList rows={result.rows} />
          )}
        </DrilldownModal>
      ) : null}
    </div>
  );
}

function Header({ model }: { model: DashboardViewModel }) {
  return (
    <header>
      {model.isDemo ? (
        <p className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong className="font-semibold">Sample data.</strong> This workspace is filled with generated content so the
          product can be reviewed before an account is connected. No figure describes a real account.
        </p>
      ) : null}

      <h1 className="text-xl font-semibold text-slate-900">Unified dashboard</h1>
      <p className="mt-1 text-sm text-slate-600">
        {model.period.label} ({model.period.start} to {model.period.end}), compared with the {model.comparison.label}.
      </p>

      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600">
        {model.syncStatus.map((row) => (
          <li key={`${row.platform}-${row.username}`} className="flex items-center gap-1">
            <span aria-hidden="true">{row.isHealthy ? '\u25CF' : '\u26A0'}</span>
            <span>
              <span className="font-medium text-slate-800">@{row.username}</span>{' '}
              {row.lastSuccessfulSyncAt ? `last synced ${row.lastSuccessfulSyncAt.slice(0, 16).replace('T', ' ')} UTC` : 'never synced'}
              {' \u2014 '}
              {row.statusText}
            </span>
          </li>
        ))}
      </ul>

      {model.coverageNotices.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {model.coverageNotices.map((notice) => (
            <li key={notice} className="text-xs leading-relaxed text-slate-700">
              {notice}
            </li>
          ))}
        </ul>
      ) : null}
    </header>
  );
}

function AiPanel({ model }: { model: DashboardViewModel }) {
  const panel = model.aiSummary;
  return (
    <section aria-labelledby="ai-summary" className="mt-8 rounded-lg border border-violet-200 bg-violet-50/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ai-summary" className="text-sm font-semibold text-slate-800">
          AI summary
        </h2>
        <p className="text-xs font-medium text-slate-700">
          Confidence: {panel.confidence} &middot; {panel.postsAnalyzed} posts, {panel.windowStart} to {panel.windowEnd}
        </p>
      </div>

      {panel.state === 'READY' && panel.text ? (
        <p className="mt-2 text-sm leading-relaxed text-slate-800">{panel.text}</p>
      ) : (
        <p className="mt-2 text-sm leading-relaxed text-slate-700">{panel.stateExplanation}</p>
      )}

      <p className="mt-2 text-xs leading-relaxed text-slate-700">
        <span className="font-medium">Why this confidence: </span>
        {panel.confidenceRationale}
      </p>

      {panel.evidence.length > 0 ? (
        <div className="mt-3 border-t border-violet-200 pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Supporting posts</h3>
          <ContentList rows={panel.evidence} />
        </div>
      ) : null}
    </section>
  );
}

function NextActions({ model }: { model: DashboardViewModel }) {
  if (model.nextActions.length === 0) return null;
  return (
    <section aria-labelledby="next-actions" className="mt-8">
      <h2 id="next-actions" className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Recommended next actions
      </h2>
      <ul className="mt-3 space-y-3">
        {model.nextActions.map((action) => (
          <li key={action.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium text-slate-900">{action.title}</h3>
              <span className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-700">
                {action.isHypothesis ? 'Hypothesis' : 'Data issue'}
              </span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-slate-700">{action.rationale}</p>
            {action.evidenceCount > 0 ? (
              <p className="mt-1 text-xs text-slate-500">Based on {action.evidenceCount} post(s).</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function DrilldownModal({
  title,
  description,
  filters,
  sort,
  onSort,
  onClose,
  children,
}: {
  title: string;
  description: string;
  filters: readonly string[];
  sort: ContentSort;
  onSort: (sort: ContentSort) => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-t-lg bg-white p-4 shadow-xl sm:rounded-lg"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            <p className="mt-1 text-xs text-slate-600">{description}</p>
            <p className="mt-1 text-xs text-slate-500">Filters: {filters.join(' \u00B7 ')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        <label className="mt-3 block text-xs text-slate-600">
          Sort by{' '}
          <select
            value={sort}
            onChange={(event) => onSort(event.target.value as ContentSort)}
            className="ml-1 rounded border border-slate-300 px-2 py-1 text-xs"
          >
            {Object.entries(SORT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}
