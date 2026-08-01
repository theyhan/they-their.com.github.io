/**
 * Builds the unified dashboard view model (spec SCR-002, FR-003).
 *
 * Pure: same input, same output. Every figure it emits carries its label, tooltip, drill-down
 * reference and - where a value is absent - the reason and corrective action.
 *
 * Two rules shape the aggregation:
 *
 *   1. Nothing is pooled across platforms unless the definitions match (spec 6.4). Post counts and
 *      followers are pooled; views, interactions and engagement rates are not, because Instagram
 *      reach-based and Threads view-based measures are different quantities.
 *   2. A period aggregate skips posts with incomplete inputs and discloses how many it skipped,
 *      rather than either fabricating a total or refusing to show one because a single post lacked a
 *      field.
 */

import {
  assessConfidence,
  computeMetricCoverage,
  followerGrowthRate,
  instagramEngagementRate,
  isCalculable,
  notCalculable,
  ok,
  performanceIndexForCohort,
  REGISTRY_VERSION,
  threadsEngagementRate,
  type CohortMember,
  type MetricValue,
} from '../metrics/index.js';
import type { MediaType, Platform } from '../platform/types.js';
import { buildChangeIndicator, excerpt, rawCountDisplay, toMetricDisplay } from './format.js';
import type {
  AiSummaryPanel,
  ContentRow,
  DashboardAccountInput,
  DashboardInput,
  DashboardPostInput,
  DashboardViewModel,
  KpiCard,
  MetricDisplay,
  NextAction,
  PlatformContribution,
  PlatformSection,
  SyncStatusRow,
  TrendPoint,
  TrendSeries,
} from './types.js';

const CONNECTION_STATUS_TEXT: Record<DashboardAccountInput['connectionStatus'], { text: string; healthy: boolean }> = {
  ACTIVE: { text: 'Connected', healthy: true },
  EXPIRING_SOON: { text: 'Connection expires soon - reconnect to avoid a gap', healthy: false },
  EXPIRED: { text: 'Connection expired - new data is not being collected', healthy: false },
  REVOKED: { text: 'Access withdrawn on the platform - reconnect to resume', healthy: false },
  INSUFFICIENT_SCOPE: { text: 'Some permissions were not granted - certain metrics are unavailable', healthy: false },
  RATE_LIMITED: { text: 'Platform rate limit reached - collection is queued and will resume', healthy: true },
};

export function buildDashboard(input: DashboardInput): DashboardViewModel {
  const syncStatus: SyncStatusRow[] = input.accounts.map((account) => {
    const status = CONNECTION_STATUS_TEXT[account.connectionStatus];
    return {
      platform: account.platform,
      username: account.username,
      lastSuccessfulSyncAt: account.lastSuccessfulSyncAt,
      statusText: status.text,
      isHealthy: status.healthy,
    };
  });

  const platformSections = input.accounts.map((account) => buildPlatformSection(account, input));
  const allRows = buildAllContentRows(input);

  const scored = allRows.filter((row) => row.performanceIndex.state === 'VALUE');
  const byIndexDesc = [...scored].sort((a, b) => (b.performanceIndex.rawValue ?? 0) - (a.performanceIndex.rawValue ?? 0));
  const unscoredCount = allRows.length - scored.length;

  return {
    generatedAt: input.generatedAt,
    isDemo: input.isDemo,
    period: input.period,
    comparison: input.comparison,
    syncStatus,
    coverageNotices: buildCoverageNotices(input),
    commonKpis: buildCommonKpis(input),
    platformSections,
    bestContent: byIndexDesc.slice(0, 3),
    worstContent: byIndexDesc.slice(-3).reverse(),
    rankingNote: buildRankingNote(unscoredCount, allRows.length),
    aiSummary: buildAiSummary(input, allRows),
    nextActions: buildNextActions(input, allRows),
  };
}

// ---------------------------------------------------------------------------
// Common KPIs
// ---------------------------------------------------------------------------

function buildCommonKpis(input: DashboardInput): KpiCard[] {
  const cards: KpiCard[] = [];
  const comparisonLabel = input.comparison.label;

  const followersEnd = sumPresent(input.accounts.map((a) => a.followersAtPeriodEnd));
  const followersStart = sumPresent(input.accounts.map((a) => a.followersAtPeriodStart));

  cards.push({
    id: 'kpi.followers',
    title: 'Followers',
    platform: null,
    metric: rawCountDisplay('account.followers_count', followersEnd.total, {
      isOutsideCoverage: followersEnd.total === null,
      tooltipExtra: 'Instagram and Threads followers are added together.',
    }),
    change: buildChangeIndicator({
      metricKey: 'account.followers_count',
      current: followersEnd.total,
      previous: followersStart.total,
      comparisonLabel,
    }),
    // A follower total is not explained by any single post, so it has no drill-down. Offering one
    // would imply a causal link the data does not support.
    drilldown: null,
    footnote:
      input.accounts.length > 1
        ? 'Combined across platforms. The same person may follow both accounts, so this is not a unique-audience figure.'
        : undefined,
  });

  cards.push({
    id: 'kpi.follower_growth',
    title: 'Follower growth',
    platform: null,
    metric: toMetricDisplay(followerGrowthRate(followersStart.total, followersEnd.total)),
    // This metric is already a change, so it carries no comparison badge.
    change: null,
    drilldown: null,
    footnote: 'Growth across the selected period, not against the comparison period.',
  });

  const postCount = input.accounts.reduce((sum, a) => sum + a.posts.length, 0);
  const comparisonPostCount = input.accounts.reduce((sum, a) => sum + a.comparisonPosts.length, 0);

  cards.push({
    id: 'kpi.posts',
    title: 'Posts published',
    platform: null,
    metric: rawCountDisplay('account.post_count', postCount),
    change: buildChangeIndicator({
      metricKey: 'account.post_count',
      current: postCount,
      previous: comparisonPostCount,
      comparisonLabel,
    }),
    drilldown: {
      metricKey: 'account.post_count',
      platform: null,
      periodStart: input.period.start,
      periodEnd: input.period.end,
      sort: 'NEWEST',
    },
    footnote: 'A post is a post on both platforms, so this total is combined. Views and interactions are not.',
  });

  return cards;
}

// ---------------------------------------------------------------------------
// Platform sections
// ---------------------------------------------------------------------------

function buildPlatformSection(account: DashboardAccountInput, input: DashboardInput): PlatformSection {
  const isInstagram = account.platform === 'INSTAGRAM';
  const viewsKey = isInstagram ? 'ig.media.views' : 'th.media.views';
  const interactionsKey = isInstagram ? 'ig.media.interactions' : 'th.media.interactions';
  const engagementKey = isInstagram ? 'ig.media.engagement_rate' : 'th.media.engagement_rate';

  const views = sumPresent(account.posts.map((p) => p.views));
  const comparisonViews = sumPresent(account.comparisonPosts.map((p) => p.views));
  const interactions = aggregateInteractions(account.platform, account.posts);
  const comparisonInteractions = aggregateInteractions(account.platform, account.comparisonPosts);
  const engagement = aggregateEngagementRate(account.platform, account.posts);
  const comparisonEngagement = aggregateEngagementRate(account.platform, account.comparisonPosts);

  const totalPosts = input.accounts.reduce((sum, a) => sum + a.posts.length, 0);
  const status = CONNECTION_STATUS_TEXT[account.connectionStatus];

  const kpis: KpiCard[] = [
    {
      id: `kpi.${account.platform}.views`,
      title: 'Views',
      platform: account.platform,
      metric: rawCountDisplay(viewsKey, views.total, {
        tooltipExtra: views.missing > 0 ? `${views.missing} post(s) did not report views and are excluded.` : undefined,
      }),
      change: buildChangeIndicator({
        metricKey: viewsKey,
        current: views.total,
        previous: comparisonViews.total,
        comparisonLabel: input.comparison.label,
      }),
      drilldown: {
        metricKey: viewsKey,
        platform: account.platform,
        periodStart: input.period.start,
        periodEnd: input.period.end,
        sort: 'VIEWS',
      },
      footnote: isInstagram
        ? undefined
        : 'Threads views are not equivalent to Instagram reach and are never added to it.',
    },
    {
      id: `kpi.${account.platform}.interactions`,
      title: 'Interactions',
      platform: account.platform,
      metric: interactions.display,
      change: buildChangeIndicator({
        metricKey: interactionsKey,
        current: interactions.display.rawValue ?? null,
        previous: comparisonInteractions.display.rawValue ?? null,
        comparisonLabel: input.comparison.label,
      }),
      drilldown: {
        metricKey: interactionsKey,
        platform: account.platform,
        periodStart: input.period.start,
        periodEnd: input.period.end,
        sort: 'INTERACTIONS',
      },
      footnote: interactions.excludedNote,
    },
    {
      id: `kpi.${account.platform}.engagement_rate`,
      title: 'Engagement rate',
      platform: account.platform,
      metric: engagement.display,
      change: buildChangeIndicator({
        metricKey: engagementKey,
        current: engagement.display.rawValue ?? null,
        previous: comparisonEngagement.display.rawValue ?? null,
        comparisonLabel: input.comparison.label,
      }),
      drilldown: {
        metricKey: engagementKey,
        platform: account.platform,
        periodStart: input.period.start,
        periodEnd: input.period.end,
        sort: 'ENGAGEMENT_RATE',
      },
      footnote: engagement.excludedNote,
    },
  ];

  const contribution: PlatformContribution = {
    platform: account.platform,
    postCount: account.posts.length,
    postSharePercent: totalPosts === 0 ? 0 : Math.round((account.posts.length / totalPosts) * 1000) / 10,
    nativeInteractions: interactions.display,
    nativeInteractionsNote:
      'Interaction totals are platform-native. Instagram counts saves and shares; Threads counts replies, reposts and quotes, so the two totals are shown side by side rather than summed.',
  };

  return {
    platform: account.platform,
    connectionStatusText: status.text,
    kpis,
    trend: buildTrend(account, input, viewsKey),
    contribution,
    coverageNotice: coverageNoticeFor(account, input),
  };
}

/**
 * Daily trend. Dates carry a state so the chart can distinguish a quiet day from a day outside
 * coverage; collapsing both to zero would draw a decline that never happened.
 */
function buildTrend(account: DashboardAccountInput, input: DashboardInput, metricKey: string): TrendSeries {
  const byDate = new Map<string, { total: number; posts: number; missing: number }>();
  for (const post of account.posts) {
    const date = post.publishedAt.slice(0, 10);
    const bucket = byDate.get(date) ?? { total: 0, posts: 0, missing: 0 };
    bucket.posts += 1;
    if (post.views === null) bucket.missing += 1;
    else bucket.total += post.views;
    byDate.set(date, bucket);
  }

  const points: TrendPoint[] = [];
  const uncoveredDates: string[] = [];
  for (const date of enumerateDates(input.period.start, input.period.end)) {
    const outside = account.dataCoverageStartsAt !== null && date < account.dataCoverageStartsAt;
    if (outside) {
      uncoveredDates.push(date);
      points.push({ date, value: null, state: 'OUTSIDE_COVERAGE', postCount: 0 });
      continue;
    }
    const bucket = byDate.get(date);
    if (!bucket || bucket.posts === 0) {
      points.push({ date, value: null, state: 'NO_ACTIVITY', postCount: 0 });
      continue;
    }
    points.push({ date, value: bucket.total, state: 'VALUE', postCount: bucket.posts });
  }

  const display = rawCountDisplay(metricKey, 0);
  return {
    metricKey,
    displayName: display.displayName,
    platform: account.platform,
    label: display.label,
    tooltip: display.tooltip,
    points,
    uncoveredDates,
  };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

interface Aggregate {
  display: MetricDisplay;
  excludedNote?: string;
}

/**
 * Period interaction total. Posts missing any term are excluded and counted, because summing the
 * terms that happen to be present would understate the total while looking plausible.
 */
function aggregateInteractions(platform: Platform, posts: readonly DashboardPostInput[]): Aggregate {
  const metricKey = platform === 'INSTAGRAM' ? 'ig.media.interactions' : 'th.media.interactions';
  const terms = (post: DashboardPostInput): Array<number | null> =>
    platform === 'INSTAGRAM'
      ? [post.likes, post.comments, post.saves, post.shares]
      : [post.likes, post.replies, post.reposts, post.quotes];

  let total = 0;
  let complete = 0;
  let excluded = 0;
  for (const post of posts) {
    const values = terms(post);
    if (values.some((v) => v === null)) {
      excluded += 1;
      continue;
    }
    // Narrowed by the guard above: every term is present for this post.
    const present: number[] = values.filter((v): v is number => v !== null);
    total += present.reduce((sum, v) => sum + v, 0);
    complete += 1;
  }

  if (complete === 0) {
    return {
      display: toMetricDisplay(
        notCalculable({
          metricKey,
          reason: posts.length === 0 ? 'NOT_YET_COLLECTED' : 'MISSING_NUMERATOR_INPUT',
          unit: 'COUNT',
          label: 'CALCULATED',
          formulaVersion: REGISTRY_VERSION,
          detail: posts.length === 0 ? undefined : { postsMissingInputs: excluded },
        }),
      ),
    };
  }

  return {
    display: toMetricDisplay(
      ok({ metricKey, value: total, unit: 'COUNT', label: 'CALCULATED', formulaVersion: REGISTRY_VERSION }),
    ),
    excludedNote:
      excluded > 0
        ? `${excluded} of ${posts.length} posts are excluded because one or more interaction counts were unavailable.`
        : undefined,
  };
}

/**
 * Period engagement rate, computed on summed inputs rather than as a mean of per-post rates. A mean
 * of rates would weight a 200-view post equally with a 90,000-view one.
 */
function aggregateEngagementRate(platform: Platform, posts: readonly DashboardPostInput[]): Aggregate {
  const complete = posts.filter((post) =>
    platform === 'INSTAGRAM'
      ? post.likes !== null && post.comments !== null && post.saves !== null && post.shares !== null
      : post.likes !== null && post.replies !== null && post.reposts !== null && post.quotes !== null,
  );
  const excluded = posts.length - complete.length;

  const value: MetricValue =
    platform === 'INSTAGRAM'
      ? instagramEngagementRate({
          likes: sumPresent(complete.map((p) => p.likes)).total,
          comments: sumPresent(complete.map((p) => p.comments)).total,
          saves: sumPresent(complete.map((p) => p.saves)).total,
          shares: sumPresent(complete.map((p) => p.shares)).total,
          // Reach is summed only when every post reported it; a partial sum would be a smaller
          // denominator and therefore an inflated rate.
          reach: allPresent(complete.map((p) => p.reach)),
          views: allPresent(complete.map((p) => p.views)),
        })
      : threadsEngagementRate({
          likes: sumPresent(complete.map((p) => p.likes)).total,
          replies: sumPresent(complete.map((p) => p.replies)).total,
          reposts: sumPresent(complete.map((p) => p.reposts)).total,
          quotes: sumPresent(complete.map((p) => p.quotes)).total,
          views: allPresent(complete.map((p) => p.views)),
        });

  const notes: string[] = [];
  if (excluded > 0) notes.push(`${excluded} of ${posts.length} posts excluded for missing interaction counts.`);
  if (isCalculable(value) && value.isFallbackDenominator) {
    notes.push('Some posts did not report reach, so this period is measured against views.');
  }

  return { display: toMetricDisplay(value), excludedNote: notes.length > 0 ? notes.join(' ') : undefined };
}

// ---------------------------------------------------------------------------
// Content rows
// ---------------------------------------------------------------------------

/**
 * Every post in the period as a display row. The drill-down resolver needs the full set, not just
 * the ranked extremes the dashboard shows, so it is built once here and shared (FR-009).
 */
export function buildAllContentRows(input: DashboardInput): ContentRow[] {
  return input.accounts.flatMap((account) => buildContentRows(account));
}

function buildContentRows(account: DashboardAccountInput): ContentRow[] {
  // Cohorts are per media type over the trailing window (ADR-0004), not over the selected period.
  // Ranking within the visible period would make a post's index change as the user changes the date
  // range, and would starve most cohorts of the 8 posts the percentile requires.
  const byType = new Map<MediaType, DashboardPostInput[]>();
  for (const post of account.cohortPosts) {
    const list = byType.get(post.mediaType) ?? [];
    list.push(post);
    byType.set(post.mediaType, list);
  }

  const indexByPost = new Map<string, MetricValue>();
  for (const [mediaType, posts] of byType) {
    const members: CohortMember[] = posts.map((post) => ({
      mediaPostId: post.mediaPostId,
      engagementRate: post.engagementRate,
    }));
    const result = performanceIndexForCohort(
      { socialAccountId: account.username, platform: account.platform, mediaType },
      members,
    );
    for (const [mediaPostId, value] of result.indices) {
      indexByPost.set(mediaPostId, value);
    }
  }

  return account.posts.map((post) => {
    const index = indexByPost.get(post.mediaPostId);
    return {
      mediaPostId: post.mediaPostId,
      platform: account.platform,
      mediaType: post.mediaType,
      publishedAt: post.publishedAt,
      excerpt: excerpt(post.caption),
      permalink: post.permalink,
      thumbnailUrl: post.thumbnailUrl,
      childMediaUrls: post.childMediaUrls,
      nativeMetrics: buildNativeMetrics(account.platform, post),
      engagementRate: toMetricDisplay(post.engagementRate),
      performanceIndex: index
        ? toMetricDisplay(index)
        : toMetricDisplay(
            notCalculable({
              metricKey: 'content.performance_index',
              reason: 'INSUFFICIENT_SAMPLE',
              unit: 'INDEX',
              label: 'CALCULATED',
              formulaVersion: REGISTRY_VERSION,
            }),
          ),
    };
  });
}

function buildNativeMetrics(platform: Platform, post: DashboardPostInput): MetricDisplay[] {
  if (platform === 'INSTAGRAM') {
    return [
      rawCountDisplay('ig.media.views', post.views),
      rawCountDisplay('ig.media.reach', post.reach),
      rawCountDisplay('ig.media.likes', post.likes),
      rawCountDisplay('ig.media.comments', post.comments),
      rawCountDisplay('ig.media.saves', post.saves),
    ];
  }
  return [
    rawCountDisplay('th.media.views', post.views),
    rawCountDisplay('th.media.likes', post.likes),
    rawCountDisplay('th.media.replies', post.replies),
    rawCountDisplay('th.media.reposts', post.reposts),
    rawCountDisplay('th.media.quotes', post.quotes),
  ];
}

function buildRankingNote(unscoredCount: number, total: number): string {
  const base =
    'Ranked by performance index, which compares each post with others of the same type on the same account. Native metrics are shown alongside, since a high index can accompany modest absolute numbers.';
  if (unscoredCount === 0) return base;
  return `${base} ${unscoredCount} of ${total} posts are unranked: their cohort has fewer than 8 comparable posts, or their engagement rate could not be calculated.`;
}

// ---------------------------------------------------------------------------
// AI panel and rule-based actions
// ---------------------------------------------------------------------------

function buildAiSummary(input: DashboardInput, rows: readonly ContentRow[]): AiSummaryPanel {
  const postsAnalyzed = rows.length;
  const coverage = computeMetricCoverage(
    rows.map((row) => ({ kind: row.engagementRate.state === 'VALUE' || row.engagementRate.state === 'VALUE_WITH_CAVEAT' ? 'value' : 'not_calculable' })),
  );
  const daysCovered = daysCoveredFor(input);
  const confidence = assessConfidence({ postsAnalyzed, daysCovered, metricCoverage: coverage, isCompetitorScope: false });

  return {
    // ADR-0006 decision 1: the narrative is produced by a queued job, never inside this request, so
    // PENDING is the normal first state rather than a failure.
    state: 'PENDING',
    confidence: confidence.level,
    confidenceRationale: confidence.rationale,
    windowStart: input.period.start,
    windowEnd: input.period.end,
    postsAnalyzed,
    // No claims yet, so no evidence. An evidence list is only meaningful attached to a conclusion.
    evidence: [],
    stateExplanation:
      'Written analysis is generated in the background and appears here when it is ready. Confidence is calculated from the evidence base before analysis runs, so it is shown now.',
  };
}

/**
 * Rule-based next actions. Deliberately not model-generated: the dashboard must remain useful and
 * fast when the AI pipeline is unavailable (ADR-0006, spec 10.1). Each is marked a hypothesis and
 * carries the number of posts behind it.
 */
function buildNextActions(input: DashboardInput, rows: readonly ContentRow[]): NextAction[] {
  const actions: NextAction[] = [];

  const byType = new Map<MediaType, number[]>();
  for (const row of rows) {
    if (row.performanceIndex.state !== 'VALUE') continue;
    const list = byType.get(row.mediaType) ?? [];
    list.push(row.performanceIndex.rawValue ?? 0);
    byType.set(row.mediaType, list);
  }

  let bestType: { mediaType: MediaType; median: number; count: number } | null = null;
  for (const [mediaType, values] of byType) {
    if (values.length < 8) continue;
    const median = medianOf(values);
    if (!bestType || median > bestType.median) bestType = { mediaType, median, count: values.length };
  }
  if (bestType) {
    actions.push({
      id: 'action.lean_into_format',
      title: `Publish more ${describeMediaType(bestType.mediaType)}`,
      rationale: `${describeMediaType(bestType.mediaType)} posts have the highest median performance index (${Math.round(bestType.median)}) among formats with enough posts to compare.`,
      isHypothesis: true,
      evidenceCount: bestType.count,
    });
  }

  const missingReach = rows.filter((row) => row.engagementRate.state === 'VALUE_WITH_CAVEAT').length;
  if (missingReach > 0) {
    actions.push({
      id: 'action.restore_reach',
      title: 'Reconnect Instagram to restore reach-based rates',
      rationale: `${missingReach} post(s) were measured against views because reach was unavailable, which is not comparable with reach-based rates elsewhere on this dashboard.`,
      isHypothesis: false,
      evidenceCount: missingReach,
    });
  }

  const gap = longestPublishingGap(input);
  if (gap.days >= 7) {
    actions.push({
      id: 'action.close_gap',
      title: 'Close the publishing gap',
      rationale: `No posts were published between ${gap.from} and ${gap.to} (${gap.days} days). Publishing rhythm is one of the few factors fully under your control.`,
      isHypothesis: true,
      evidenceCount: 0,
    });
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Notices and helpers
// ---------------------------------------------------------------------------

function buildCoverageNotices(input: DashboardInput): string[] {
  const notices: string[] = [];
  for (const account of input.accounts) {
    const notice = coverageNoticeFor(account, input);
    if (notice) notices.push(notice);
  }
  if (input.isDemo) {
    notices.push('This workspace uses generated sample data. No figure here describes a real account.');
  }
  return notices;
}

function coverageNoticeFor(account: DashboardAccountInput, input: DashboardInput): string | undefined {
  if (account.dataCoverageStartsAt === null) return undefined;
  if (account.dataCoverageStartsAt <= input.period.start) return undefined;
  const platformName = account.platform === 'THREADS' ? 'Threads' : 'Instagram';
  const reason =
    account.platform === 'THREADS'
      ? ' Threads does not provide data from before 13 April 2024.'
      : '';
  return `${platformName} data starts on ${account.dataCoverageStartsAt}, which is after the start of the selected period.${reason} Earlier dates are shown as outside coverage rather than as zero.`;
}

function sumPresent(values: readonly (number | null)[]): { total: number | null; missing: number } {
  let total = 0;
  let seen = 0;
  let missing = 0;
  for (const value of values) {
    if (value === null) missing += 1;
    else {
      total += value;
      seen += 1;
    }
  }
  return { total: seen === 0 ? null : total, missing };
}

/** Sums only when every value is present; otherwise null. Used for denominators. */
function allPresent(values: readonly (number | null)[]): number | null {
  if (values.length === 0) return null;
  let total = 0;
  for (const value of values) {
    if (value === null) return null;
    total += value;
  }
  return total;
}

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function daysCoveredFor(input: DashboardInput): number {
  const starts = input.accounts
    .map((a) => a.dataCoverageStartsAt)
    .filter((value): value is string => value !== null);
  const coverageStart = starts.length > 0 ? starts.reduce((min, v) => (v < min ? v : min)) : input.period.start;
  const effectiveStart = coverageStart > input.period.start ? coverageStart : input.period.start;
  return Math.max(0, daysBetween(effectiveStart, input.period.end) + 1);
}

function longestPublishingGap(input: DashboardInput): { days: number; from: string; to: string } {
  const dates = new Set<string>();
  for (const account of input.accounts) {
    for (const post of account.posts) dates.add(post.publishedAt.slice(0, 10));
  }
  let longest = { days: 0, from: input.period.start, to: input.period.start };
  let runStart: string | null = null;
  let runLength = 0;

  for (const date of enumerateDates(input.period.start, input.period.end)) {
    if (dates.has(date)) {
      if (runStart !== null && runLength > longest.days) {
        longest = { days: runLength, from: runStart, to: previousDate(date) };
      }
      runStart = null;
      runLength = 0;
      continue;
    }
    if (runStart === null) runStart = date;
    runLength += 1;
  }
  if (runStart !== null && runLength > longest.days) {
    longest = { days: runLength, from: runStart, to: input.period.end };
  }
  return longest;
}

function describeMediaType(mediaType: MediaType): string {
  const names: Record<MediaType, string> = {
    IG_IMAGE: 'single image',
    IG_CAROUSEL: 'carousel',
    IG_REEL: 'Reels',
    IG_STORY: 'Story',
    IG_VIDEO: 'video',
    TH_TEXT: 'text-only',
    TH_IMAGE: 'image',
    TH_VIDEO: 'video',
    TH_CAROUSEL: 'carousel',
    TH_REPOST: 'repost',
  };
  return names[mediaType];
}

export function enumerateDates(start: string, end: string): string[] {
  const dates: string[] = [];
  let cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    const next = new Date(cursor.getTime());
    next.setUTCDate(next.getUTCDate() + 1);
    cursor = next;
  }
  return dates;
}

function previousDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(start: string, end: string): number {
  const ms = new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}
