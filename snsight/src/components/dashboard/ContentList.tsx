import type { ContentRow } from '@/lib/dashboard/types';
import { MetricLabelBadge, MetricValueBlock } from './primitives';

/**
 * Content rows (SCR-002 row 3, FR-009). Native metrics are always shown beside the performance
 * index, because an index is relative: a post can rank in an account's top decile while its absolute
 * numbers are modest, and showing only the score would overstate it.
 */
export function ContentList({ rows, emptyMessage }: { rows: readonly ContentRow[]; emptyMessage?: string }) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-600">{emptyMessage ?? 'No content matches these filters.'}</p>;
  }

  return (
    <ul className="divide-y divide-slate-200">
      {rows.map((row) => (
        <li key={`${row.platform}-${row.mediaPostId}`} className="py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="font-medium text-slate-700">
                  {row.platform === 'INSTAGRAM' ? 'Instagram' : 'Threads'}
                </span>
                <span>{row.mediaType}</span>
                <span>{row.publishedAt.slice(0, 10)}</span>
                {row.childMediaUrls.length > 0 ? <span>{row.childMediaUrls.length} slides</span> : null}
              </p>
              <p className="mt-1 text-sm text-slate-800">{row.excerpt}</p>
              {row.permalink ? (
                <a
                  href={row.permalink}
                  className="mt-1 inline-block text-xs text-sky-800 underline"
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  Open the original post
                </a>
              ) : null}
            </div>

            <div className="w-40 shrink-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-600">{row.performanceIndex.displayName}</span>
                <MetricLabelBadge display={row.performanceIndex} />
              </div>
              <div className="mt-1">
                <MetricValueBlock display={row.performanceIndex} />
              </div>
            </div>
          </div>

          <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs">
            {[row.engagementRate, ...row.nativeMetrics].map((metric) => (
              <div key={metric.metricKey} className="flex items-baseline gap-1">
                <dt className="text-slate-500">{metric.displayName}</dt>
                <dd className="font-medium tabular-nums text-slate-800" title={metric.tooltip}>
                  {metric.state === 'VALUE' || metric.state === 'VALUE_WITH_CAVEAT' ? (
                    <>
                      {metric.valueText}
                      {metric.state === 'VALUE_WITH_CAVEAT' ? (
                        <span className="ml-1 text-amber-900" title={metric.caveat}>
                          (on views)
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="font-normal text-slate-500" title={`${metric.reasonText} ${metric.actionText}`}>
                      {metric.state === 'NOT_SYNCED' ? 'not collected' : 'not calculable'}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ul>
  );
}
