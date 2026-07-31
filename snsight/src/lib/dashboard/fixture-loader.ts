/**
 * Assembles `DashboardInput` from the fixture provider (ADR-0007 decision 4).
 *
 * The same shape will be produced from Postgres once collection is live, so the view model and the
 * components downstream of it do not change when the provider does.
 */

import {
  instagramEngagementRate,
  PERFORMANCE_INDEX_WINDOW_DAYS,
  threadsEngagementRate,
} from '../metrics/index.js';
import { FixtureProvider } from '../platform/fixture/provider.js';
import type { NormalizedMediaPost, Platform, ProviderContext } from '../platform/types.js';
import { daysBetween } from './build.js';
import type { DashboardAccountInput, DashboardInput, DashboardPeriod, DashboardPostInput } from './types.js';

export interface LoadOptions {
  asOf: Date;
  /** 7, 30 or 90 per FR-003; any custom length works. */
  periodDays?: number;
  seed?: string;
  platforms?: readonly Platform[];
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shift(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function buildPeriods(asOf: Date, periodDays: number): { period: DashboardPeriod; comparison: DashboardPeriod } {
  const end = asOf;
  const start = shift(end, -(periodDays - 1));
  const comparisonEnd = shift(start, -1);
  const comparisonStart = shift(comparisonEnd, -(periodDays - 1));

  return {
    period: { start: isoDate(start), end: isoDate(end), label: `Last ${periodDays} days`, days: periodDays },
    comparison: {
      start: isoDate(comparisonStart),
      end: isoDate(comparisonEnd),
      label: `previous ${periodDays} days`,
      days: periodDays,
    },
  };
}

export async function loadFixtureDashboard(options: LoadOptions): Promise<DashboardInput> {
  const periodDays = options.periodDays ?? 30;
  const { period, comparison } = buildPeriods(options.asOf, periodDays);
  const platforms = options.platforms ?? (['INSTAGRAM', 'THREADS'] as const);

  const accounts: DashboardAccountInput[] = [];

  for (const platform of platforms) {
    const provider = new FixtureProvider(platform, { asOf: options.asOf, seed: options.seed ?? 'demo', historyDays: 240 });
    const ctx: ProviderContext = {
      workspaceId: 'ws_demo',
      socialAccountId: `acc_demo_${platform.toLowerCase()}`,
      platformUserId: platform === 'INSTAGRAM' ? '17841400000000000' : '98765400000000000',
      accessToken: 'fixture-token',
      grantedScopes: ['insights', 'business_discovery'],
      apiVersion: 'v21.0',
    };

    const account = await provider.fetchAccount(ctx);
    if (!account.ok) continue;

    const current = await provider.fetchMedia(ctx, { since: period.start, until: period.end });
    const previous = await provider.fetchMedia(ctx, { since: comparison.start, until: comparison.end });
    // The cohort window is independent of the selected period (ADR-0004).
    const cohort = await provider.fetchMedia(ctx, {
      since: isoDate(shift(options.asOf, -(PERFORMANCE_INDEX_WINDOW_DAYS - 1))),
      until: period.end,
    });

    const followersEnd = account.data.followersCount;
    // Followers over time come from daily snapshots in production. The fixture derives earlier
    // values from a modest growth assumption, and they are labelled ESTIMATE downstream.
    const followersStart = followersEnd === null ? null : Math.round(followersEnd * 0.96);
    const followersComparisonStart = followersEnd === null ? null : Math.round(followersEnd * 0.93);

    accounts.push({
      platform,
      username: account.data.username,
      lastSuccessfulSyncAt: new Date(options.asOf.getTime() - 42 * 60 * 1000).toISOString(),
      // Instagram is deliberately left short of full permissions in the demo, so the
      // INSUFFICIENT_SCOPE presentation is visible without contriving a broken account.
      connectionStatus: platform === 'INSTAGRAM' ? 'ACTIVE' : 'EXPIRING_SOON',
      dataCoverageStartsAt: account.data.dataCoverageStartsAt,
      followersAtPeriodStart: followersStart,
      followersAtPeriodEnd: followersEnd,
      followersAtComparisonStart: followersComparisonStart,
      posts: current.ok ? current.data.map((post) => toPostInput(platform, post)) : [],
      comparisonPosts: previous.ok ? previous.data.map((post) => toPostInput(platform, post)) : [],
      cohortPosts: cohort.ok ? cohort.data.map((post) => toPostInput(platform, post)) : [],
    });
  }

  return {
    isDemo: true,
    period,
    comparison,
    accounts,
    generatedAt: options.asOf.toISOString(),
  };
}

function toPostInput(platform: Platform, post: NormalizedMediaPost): DashboardPostInput {
  const m = post.metrics;
  const engagementRate =
    platform === 'INSTAGRAM'
      ? instagramEngagementRate({ ...m, hasInsightsScope: true })
      : threadsEngagementRate({ ...m, hasInsightsScope: true });

  return {
    mediaPostId: post.platformMediaId,
    mediaType: post.mediaType,
    publishedAt: post.publishedAt,
    caption: post.caption,
    permalink: post.permalink,
    thumbnailUrl: post.thumbnailUrl,
    childMediaUrls: post.childMediaUrls,
    likes: m.likes,
    comments: m.comments,
    saves: m.saves,
    shares: m.shares,
    views: m.views,
    reach: m.reach,
    replies: m.replies,
    reposts: m.reposts,
    quotes: m.quotes,
    engagementRate,
  };
}

export { daysBetween };
