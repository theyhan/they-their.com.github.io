/**
 * Metric-to-content drill-down (spec FR-009, and the mandatory rule that "clicking a chart data
 * point must reveal the corresponding content").
 *
 * Resolution is a pure function of a reference plus the content rows, so what a KPI card claims and
 * what its drill-down shows are guaranteed to come from the same filters. Recomputing the filter in
 * the UI is how the two drift apart.
 */

import type { ContentRow, ContentSort, DrilldownRef, MetricDisplay } from './types.js';

export interface DrilldownRequest {
  readonly ref: DrilldownRef;
  readonly rows: readonly ContentRow[];
  /** Set when the user clicked a single point on a trend chart rather than a KPI card. */
  readonly onDate?: string;
  readonly sortOverride?: ContentSort;
}

export interface DrilldownResult {
  readonly title: string;
  readonly description: string;
  readonly appliedFilters: readonly string[];
  readonly sort: ContentSort;
  readonly rows: readonly ContentRow[];
  /** Present when nothing matched. Must explain why and offer a way forward. */
  readonly emptyState?: { readonly reason: string; readonly action: string };
}

export function resolveDrilldown(request: DrilldownRequest): DrilldownResult {
  const { ref, rows, onDate } = request;
  const sort = request.sortOverride ?? ref.sort;

  const filters: string[] = [];
  let matched = [...rows];

  if (ref.platform !== null) {
    matched = matched.filter((row) => row.platform === ref.platform);
    filters.push(ref.platform === 'INSTAGRAM' ? 'Instagram' : 'Threads');
  } else {
    filters.push('All platforms');
  }

  if (ref.mediaType !== undefined) {
    matched = matched.filter((row) => row.mediaType === ref.mediaType);
    filters.push(ref.mediaType);
  }

  if (onDate !== undefined) {
    matched = matched.filter((row) => row.publishedAt.slice(0, 10) === onDate);
    filters.push(onDate);
  } else {
    matched = matched.filter((row) => {
      const date = row.publishedAt.slice(0, 10);
      return date >= ref.periodStart && date <= ref.periodEnd;
    });
    filters.push(`${ref.periodStart} to ${ref.periodEnd}`);
  }

  const sorted = sortRows(matched, sort);

  return {
    title: onDate !== undefined ? `Posts published on ${onDate}` : 'Posts behind this figure',
    description:
      onDate !== undefined
        ? 'Content published on the selected date, using the same account and platform filters as the chart.'
        : 'Content matching the metric, period and account filters used for the figure you selected.',
    appliedFilters: filters,
    sort,
    rows: sorted,
    emptyState:
      sorted.length === 0
        ? {
            reason:
              onDate !== undefined
                ? 'Nothing was published on this date, so no content explains this point.'
                : 'No content matches the current filters for this period.',
            action: 'Widen the date range, or clear the platform and format filters.',
          }
        : undefined,
  };
}

/**
 * Sorts rows, always placing rows whose sort metric is unavailable at the end regardless of
 * direction. Treating a NotCalculable as zero would rank a post with missing permissions as the
 * worst performer, which is a claim the data does not support.
 */
export function sortRows(rows: readonly ContentRow[], sort: ContentSort): ContentRow[] {
  if (sort === 'NEWEST') {
    return [...rows].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  }

  const valueOf = (row: ContentRow): number | null => {
    switch (sort) {
      case 'VIEWS':
        return numeric(findMetric(row, ['ig.media.views', 'th.media.views']));
      case 'INTERACTIONS':
        return interactionTotal(row);
      case 'ENGAGEMENT_RATE':
        return numeric(row.engagementRate);
      case 'PERFORMANCE_INDEX':
        return numeric(row.performanceIndex);
      default:
        return null;
    }
  };

  return [...rows].sort((a, b) => {
    const left = valueOf(a);
    const right = valueOf(b);
    if (left === null && right === null) return b.publishedAt.localeCompare(a.publishedAt);
    if (left === null) return 1;
    if (right === null) return -1;
    if (left === right) return b.publishedAt.localeCompare(a.publishedAt);
    return right - left;
  });
}

function findMetric(row: ContentRow, metricKeys: readonly string[]): MetricDisplay | undefined {
  return row.nativeMetrics.find((metric) => metricKeys.includes(metric.metricKey));
}

function numeric(metric: MetricDisplay | undefined): number | null {
  if (!metric) return null;
  if (metric.state !== 'VALUE' && metric.state !== 'VALUE_WITH_CAVEAT') return null;
  return metric.rawValue ?? null;
}

/**
 * Interaction total for sorting only, summed from whichever native metrics are present. Kept out of
 * the displayed metric set on purpose: a partial sum is adequate for ordering but must never be
 * presented as the account's interaction total, which `aggregateInteractions` computes strictly.
 */
function interactionTotal(row: ContentRow): number | null {
  const keys = [
    'ig.media.likes',
    'ig.media.comments',
    'ig.media.saves',
    'th.media.likes',
    'th.media.replies',
    'th.media.reposts',
    'th.media.quotes',
  ];
  let total = 0;
  let seen = 0;
  for (const metric of row.nativeMetrics) {
    if (!keys.includes(metric.metricKey)) continue;
    const value = numeric(metric);
    if (value === null) continue;
    total += value;
    seen += 1;
  }
  return seen === 0 ? null : total;
}

export const SORT_LABELS: Record<ContentSort, string> = {
  NEWEST: 'Newest first',
  VIEWS: 'Most views',
  INTERACTIONS: 'Most interactions',
  ENGAGEMENT_RATE: 'Highest engagement rate',
  PERFORMANCE_INDEX: 'Highest performance index',
};
