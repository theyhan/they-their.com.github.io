/**
 * The 0-100 performance index (spec 6.4, defined by ADR-0004).
 *
 * A post's index is its midrank percentile within its own cohort - same account, same platform,
 * same media type - over a trailing window. Nothing is ranked against other workspaces, so tenant
 * isolation (spec 10.2) is preserved, and nothing is ranked across platforms, so the
 * incomparability rule in spec 6.4 holds.
 */

import { REGISTRY_VERSION } from './registry.js';
import { isCalculable, notCalculable, ok, roundMetric, type MetricValue } from './types.js';

export const PERFORMANCE_INDEX_MIN_SAMPLE = 8;
export const PERFORMANCE_INDEX_WINDOW_DAYS = 90;
const METRIC_KEY = 'content.performance_index';

export interface CohortKey {
  socialAccountId: string;
  platform: 'INSTAGRAM' | 'THREADS';
  mediaType: string;
}

export interface CohortMember {
  mediaPostId: string;
  /** The platform-native engagement rate from ADR-0003. */
  engagementRate: MetricValue;
}

export interface PerformanceIndexResult {
  readonly cohort: CohortKey;
  readonly indices: ReadonlyMap<string, MetricValue>;
  /** Posts whose engagement rate was not calculable and were left out of the ranking. */
  readonly excludedCount: number;
  /** Posts actually ranked. Disclosed with the index, since the percentile depends on it. */
  readonly sampleSize: number;
  readonly windowDays: number;
}

function unavailable(reason: 'INSUFFICIENT_SAMPLE', detail: Record<string, number>): MetricValue {
  return notCalculable({
    metricKey: METRIC_KEY,
    unit: 'INDEX',
    label: 'CALCULATED',
    formulaVersion: REGISTRY_VERSION,
    reason,
    detail,
  });
}

/**
 * Ranks a cohort.
 *
 * Members whose engagement rate is not calculable are excluded rather than treated as zero
 * (ADR-0004 decision 5); counting them as zero would inflate every other post's percentile
 * whenever a permission was missing.
 */
export function performanceIndexForCohort(
  cohort: CohortKey,
  members: readonly CohortMember[],
  windowDays: number = PERFORMANCE_INDEX_WINDOW_DAYS,
): PerformanceIndexResult {
  const ranked = members.filter((m) => isCalculable(m.engagementRate));
  const excludedCount = members.length - ranked.length;
  const indices = new Map<string, MetricValue>();

  if (ranked.length < PERFORMANCE_INDEX_MIN_SAMPLE) {
    const detail = { present: ranked.length, required: PERFORMANCE_INDEX_MIN_SAMPLE };
    for (const member of members) {
      indices.set(member.mediaPostId, unavailable('INSUFFICIENT_SAMPLE', detail));
    }
    return { cohort, indices, excludedCount, sampleSize: ranked.length, windowDays };
  }

  // Sort ascending by rate; ties are grouped so they can share a midrank.
  const sorted = [...ranked].sort((a, b) => rateOf(a) - rateOf(b));
  const n = sorted.length;

  // Midranks: for a run of equal values spanning positions i..j (1-based), every member takes the
  // mean of those positions. Identical inputs therefore always produce identical indices.
  const midranks = new Map<string, number>();
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && rateOf(sorted[j + 1]!) === rateOf(sorted[i]!)) j += 1;
    const meanRank = (i + 1 + (j + 1)) / 2;
    for (let k = i; k <= j; k += 1) {
      midranks.set(sorted[k]!.mediaPostId, meanRank);
    }
    i = j + 1;
  }

  // Scale so the lowest ranked post is 0 and the highest is 100. n >= 8 here, so no division by
  // zero is possible.
  for (const [mediaPostId, meanRank] of midranks) {
    indices.set(
      mediaPostId,
      ok({
        metricKey: METRIC_KEY,
        value: roundMetric(((meanRank - 1) / (n - 1)) * 100),
        unit: 'INDEX',
        label: 'CALCULATED',
        formulaVersion: REGISTRY_VERSION,
        denominatorUsed: `cohort of ${n}`,
      }),
    );
  }

  // Excluded members still get an entry, so a caller iterating posts never finds a gap.
  for (const member of members) {
    if (!indices.has(member.mediaPostId)) {
      indices.set(
        member.mediaPostId,
        notCalculable({
          metricKey: METRIC_KEY,
          unit: 'INDEX',
          label: 'CALCULATED',
          formulaVersion: REGISTRY_VERSION,
          reason: member.engagementRate.kind === 'not_calculable' ? member.engagementRate.reason : 'INSUFFICIENT_SAMPLE',
        }),
      );
    }
  }

  return { cohort, indices, excludedCount, sampleSize: n, windowDays };
}

function rateOf(member: CohortMember): number {
  return member.engagementRate.kind === 'value' ? member.engagementRate.value : Number.NaN;
}

/** Tooltip text. The cohort definition must travel with the number, or the percentile is unauditable. */
export function describeCohort(result: PerformanceIndexResult): string {
  const { cohort, sampleSize, windowDays, excludedCount } = result;
  const excluded =
    excludedCount > 0 ? ` ${excludedCount} post(s) were excluded because their engagement rate could not be calculated.` : '';
  return (
    `Percentile within this account's ${cohort.mediaType} posts on ${cohort.platform} ` +
    `over the last ${windowDays} days (${sampleSize} posts compared).${excluded} ` +
    `Relative to this account only, not an absolute score.`
  );
}
