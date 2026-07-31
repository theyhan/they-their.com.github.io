/**
 * Executable checks for the metric core and fixture provider.
 *
 * Deliberately dependency-free so it runs before `npm install` is possible, via
 * `bun scripts/verify-core.ts` or `npx tsx scripts/verify-core.ts`. Once the toolchain is
 * installed these move to Vitest; the assertions do not change.
 *
 * What these checks defend is the behaviour the ADRs exist to guarantee: that an unknowable metric
 * cannot become a zero, that a fallback denominator is always disclosed, that a percentile is not
 * published on a sample too small to support it, and that competitor data cannot carry owner-only
 * fields.
 */

import {
  assessConfidence,
  assertRegistryIntegrity,
  computeMetricCoverage,
  describeCohort,
  followerGrowthRate,
  instagramEngagementRate,
  instagramSaveRate,
  isCalculable,
  NOT_CALCULABLE_COPY,
  performanceIndexForCohort,
  publishingIntervalDays,
  threadsConversationSpreadRate,
  threadsEngagementRate,
  threadsPostClickThroughRate,
  type CohortMember,
  type MetricValue,
  type NotCalculableReason,
} from '../src/lib/metrics/index.js';
import { toProviderError } from '../src/lib/platform/errors.js';
import { FixtureCompetitorProvider, FixtureProvider } from '../src/lib/platform/fixture/provider.js';
import type { ProviderContext } from '../src/lib/platform/types.js';

import { check, expect, report } from './harness.js';

function expectValue(actual: MetricValue, expected: number, tolerance = 0.0001): void {
  expect(isCalculable(actual), `expected a value but got ${describe(actual)}`);
  if (!isCalculable(actual)) return;
  expect(
    Math.abs(actual.value - expected) <= tolerance,
    `expected ${expected} but got ${actual.value}`,
  );
}

function expectReason(actual: MetricValue, reason: NotCalculableReason): void {
  expect(actual.kind === 'not_calculable', `expected NotCalculable(${reason}) but got a value`);
  if (actual.kind !== 'not_calculable') return;
  expect(actual.reason === reason, `expected reason ${reason} but got ${actual.reason}`);
}

function describe(value: MetricValue): string {
  return value.kind === 'value' ? `value ${value.value}` : `not_calculable ${value.reason}`;
}

const ctx: ProviderContext = {
  workspaceId: 'ws_demo',
  socialAccountId: 'acc_demo',
  platformUserId: '17841400000000000',
  accessToken: 'fixture-token',
  grantedScopes: ['insights', 'business_discovery'],
  apiVersion: 'v21.0',
};

const asOf = new Date('2026-07-31T00:00:00Z');

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

check('registry integrity holds', () => {
  assertRegistryIntegrity();
});

check('every NotCalculable reason has empty-state copy', () => {
  const reasons: NotCalculableReason[] = [
    'MISSING_DENOMINATOR',
    'ZERO_DENOMINATOR',
    'MISSING_NUMERATOR_INPUT',
    'METRIC_NOT_AVAILABLE_IN_API_VERSION',
    'METRIC_NOT_AVAILABLE_AT_SCOPE',
    'SCOPE_NOT_GRANTED',
    'COMPETITOR_SCOPE_FORBIDDEN',
    'INSUFFICIENT_SAMPLE',
    'NOT_YET_COLLECTED',
  ];
  for (const reason of reasons) {
    const copy = NOT_CALCULABLE_COPY[reason];
    expect(copy !== undefined, `no copy for ${reason}`);
    expect(copy.action.length > 0, `no corrective action for ${reason}`);
  }
});

// ---------------------------------------------------------------------------
// Instagram formulas (ADR-0003)
// ---------------------------------------------------------------------------

check('Instagram engagement rate uses reach when present', () => {
  const result = instagramEngagementRate({ likes: 100, comments: 10, saves: 20, shares: 5, reach: 1000, views: 2000 });
  expectValue(result, 13.5);
  expect(isCalculable(result) && result.denominatorUsed === 'ig.media.reach', 'expected reach as denominator');
  expect(isCalculable(result) && result.isFallbackDenominator === false, 'reach must not be flagged as a fallback');
});

check('Instagram engagement rate falls back to views and discloses it', () => {
  const result = instagramEngagementRate({ likes: 100, comments: 10, saves: 20, shares: 5, reach: null, views: 2000 });
  expectValue(result, 6.75);
  expect(isCalculable(result) && result.denominatorUsed === 'ig.media.views', 'expected views as denominator');
  expect(isCalculable(result) && result.isFallbackDenominator, 'fallback must be disclosed on the value');
});

check('Instagram engagement rate is NotCalculable without any denominator', () => {
  expectReason(
    instagramEngagementRate({ likes: 100, comments: 10, saves: 20, shares: 5, reach: null, views: null }),
    'MISSING_DENOMINATOR',
  );
});

check('a missing numerator term does not silently shrink the rate', () => {
  // The defect ADR-0003 was written to prevent: dropping saves would yield a plausible 11.5%.
  const result = instagramEngagementRate({ likes: 100, comments: 10, saves: null, shares: 5, reach: 1000 });
  expectReason(result, 'MISSING_NUMERATOR_INPUT');
  expect(
    result.kind === 'not_calculable' && String(result.detail?.missing).includes('saves'),
    'the empty state must name the missing input',
  );
});

check('zero views yields ZERO_DENOMINATOR, not zero percent', () => {
  expectReason(
    instagramEngagementRate({ likes: 0, comments: 0, saves: 0, shares: 0, reach: null, views: 0 }),
    'ZERO_DENOMINATOR',
  );
});

check('missing insights scope is reported as a permission problem', () => {
  expectReason(
    instagramEngagementRate({ likes: 1, comments: 1, saves: 1, shares: 1, reach: 100, hasInsightsScope: false }),
    'SCOPE_NOT_GRANTED',
  );
});

check('save rate does not fall back to views', () => {
  // Spec 6.2 defines save rate against reach; substituting views would change its meaning.
  expectReason(instagramSaveRate({ saves: 10, reach: null, views: 5000 }), 'MISSING_DENOMINATOR');
});

// ---------------------------------------------------------------------------
// Threads formulas (ADR-0003)
// ---------------------------------------------------------------------------

check('Threads engagement rate sums Threads interactions over views', () => {
  expectValue(threadsEngagementRate({ likes: 50, replies: 10, reposts: 5, quotes: 2, views: 1000 }), 6.7);
});

check('conversation spread rate excludes likes', () => {
  expectValue(threadsConversationSpreadRate({ replies: 10, reposts: 5, quotes: 5, views: 1000 }), 2);
});

check('per-post Threads click-through rate reports the scope mismatch', () => {
  const result = threadsPostClickThroughRate();
  expectReason(result, 'METRIC_NOT_AVAILABLE_AT_SCOPE');
  expect(
    result.kind === 'not_calculable' && result.detail?.availableScope === 'ACCOUNT',
    'the empty state must point at the scope that does work',
  );
});

// ---------------------------------------------------------------------------
// Cross-platform formulas
// ---------------------------------------------------------------------------

check('follower growth rate handles a zero starting point', () => {
  expectReason(followerGrowthRate(0, 500), 'ZERO_DENOMINATOR');
  expectValue(followerGrowthRate(1000, 1250), 25);
});

check('publishing interval with no posts is not an interval of zero', () => {
  expectReason(publishingIntervalDays(30, 0), 'ZERO_DENOMINATOR');
  expectValue(publishingIntervalDays(30, 12), 2.5);
});

// ---------------------------------------------------------------------------
// Performance index (ADR-0004)
// ---------------------------------------------------------------------------

const cohortKey = { socialAccountId: 'acc_demo', platform: 'INSTAGRAM' as const, mediaType: 'IG_REEL' };

function member(id: string, rate: number | null): CohortMember {
  return {
    mediaPostId: id,
    engagementRate:
      rate === null
        ? { kind: 'not_calculable', metricKey: 'ig.media.engagement_rate', reason: 'MISSING_DENOMINATOR', unit: 'PERCENT', label: 'CALCULATED', formulaVersion: 'test' }
        : { kind: 'value', metricKey: 'ig.media.engagement_rate', value: rate, unit: 'PERCENT', label: 'CALCULATED', isFallbackDenominator: false, formulaVersion: 'test' },
  };
}

check('a cohort below the minimum sample is not scored', () => {
  const members = [1, 2, 3, 4, 5].map((n) => member(`p${n}`, n));
  const result = performanceIndexForCohort(cohortKey, members);
  expect(result.sampleSize === 5, `expected sampleSize 5, got ${result.sampleSize}`);
  for (const value of result.indices.values()) {
    expectReason(value, 'INSUFFICIENT_SAMPLE');
  }
  const first = result.indices.get('p1')!;
  expect(
    first.kind === 'not_calculable' && first.detail?.required === 8,
    'the empty state must state how many posts are required',
  );
});

check('a scored cohort spans 0 to 100', () => {
  const members = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => member(`p${n}`, n * 1.5));
  const result = performanceIndexForCohort(cohortKey, members);
  expectValue(result.indices.get('p1')!, 0);
  expectValue(result.indices.get('p8')!, 100);
  expect(result.sampleSize === 8, 'all eight posts should be ranked');
});

check('ties share a midrank', () => {
  const members = [member('a', 5), member('b', 5), ...[3, 4, 5, 6, 7, 8].map((n) => member(`p${n}`, 10 + n))];
  const result = performanceIndexForCohort(cohortKey, members);
  const a = result.indices.get('a')!;
  const b = result.indices.get('b')!;
  expect(isCalculable(a) && isCalculable(b) && a.value === b.value, 'equal rates must produce equal indices');
  // Midrank of positions 1 and 2 is 1.5, scaled over n = 8: (1.5 - 1) / 7 * 100.
  expectValue(a, 7.1429, 0.001);
});

check('uncalculable members are excluded rather than counted as zero', () => {
  const calculable = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => member(`p${n}`, n * 1.5));
  const withGap = [...calculable, member('missing', null)];
  const result = performanceIndexForCohort(cohortKey, withGap);

  expect(result.sampleSize === 8, `expected 8 ranked, got ${result.sampleSize}`);
  expect(result.excludedCount === 1, `expected 1 excluded, got ${result.excludedCount}`);
  // The excluded post must not have displaced anyone: the weakest ranked post is still 0.
  expectValue(result.indices.get('p1')!, 0);
  expectReason(result.indices.get('missing')!, 'MISSING_DENOMINATOR');
  expect(describeCohort(result).includes('excluded'), 'the tooltip must disclose exclusions');
});

// ---------------------------------------------------------------------------
// Confidence rubric (ADR-0006)
// ---------------------------------------------------------------------------

check('confidence follows the published rubric', () => {
  const high = assessConfidence({ postsAnalyzed: 30, daysCovered: 30, metricCoverage: 0.95, isCompetitorScope: false });
  expect(high.level === 'HIGH', `expected HIGH, got ${high.level}`);

  const medium = assessConfidence({ postsAnalyzed: 10, daysCovered: 20, metricCoverage: 0.75, isCompetitorScope: false });
  expect(medium.level === 'MEDIUM', `expected MEDIUM, got ${medium.level}`);

  const low = assessConfidence({ postsAnalyzed: 3, daysCovered: 7, metricCoverage: 0.5, isCompetitorScope: false });
  expect(low.level === 'LOW', `expected LOW, got ${low.level}`);
  expect(low.rationale.includes('3 post'), 'the rationale must quote the evidence base');
});

check('competitor analysis is capped at LOW regardless of volume', () => {
  const result = assessConfidence({ postsAnalyzed: 500, daysCovered: 365, metricCoverage: 1, isCompetitorScope: true });
  expect(result.level === 'LOW', `expected LOW for competitor scope, got ${result.level}`);
});

check('metric coverage is measured from real results', () => {
  const values = [
    { kind: 'value' as const },
    { kind: 'value' as const },
    { kind: 'value' as const },
    { kind: 'not_calculable' as const },
  ];
  expect(computeMetricCoverage(values) === 0.75, 'expected 0.75 coverage');
  expect(computeMetricCoverage([]) === 0, 'empty input must not be full coverage');
});

// ---------------------------------------------------------------------------
// Error translation (FR-002, acceptance criterion 8)
// ---------------------------------------------------------------------------

check('expired tokens are not retried', () => {
  const error = toProviderError({ code: 190, subcode: 463, httpStatus: 400 });
  expect(error.code === 'TOKEN_EXPIRED', `got ${error.code}`);
  expect(!error.isRetryable, 'an expired token must not be retried');
  expect(error.connectionStatus === 'EXPIRED', 'the connection status must change');
  expect(error.userAction.length > 0, 'guidance must be recoverable');
});

check('de-authorisation is distinguished from expiry', () => {
  expect(toProviderError({ code: 190, subcode: 458 }).code === 'TOKEN_REVOKED', 'subcode 458 is a revocation');
});

check('rate limits defer instead of failing', () => {
  const error = toProviderError({ code: 4, httpStatus: 400 });
  expect(error.code === 'RATE_LIMITED', `got ${error.code}`);
  expect(error.isRetryable && (error.retryAfterSeconds ?? 0) > 0, 'a rate limit must schedule a retry');
});

check('unmapped provider errors stay visible', () => {
  const error = toProviderError({ code: 99999, httpStatus: 400, message: 'something new' });
  expect(error.code === 'UNMAPPED_PROVIDER_ERROR', `got ${error.code}`);
  expect(error.isRetryable, 'an unmapped error must not be swallowed');
  expect((error.diagnostic ?? '').includes('something new'), 'the raw detail must survive for logs');
});

check('tokens never appear in diagnostics', () => {
  const error = toProviderError({ code: 190, subcode: 463, message: 'token fixture-token is invalid' });
  expect(!(error.diagnostic ?? '').includes('fixture-token'), 'mapped errors must not echo credentials');
});

// ---------------------------------------------------------------------------
// Fixture provider (ADR-0007)
// ---------------------------------------------------------------------------

const igProvider = new FixtureProvider('INSTAGRAM', { asOf, seed: 'demo', historyDays: 120 });
const thProvider = new FixtureProvider('THREADS', { asOf, seed: 'demo', historyDays: 900 });
const window = { since: '2026-01-01', until: '2026-07-31' };

const igPosts = await igProvider.fetchMedia(ctx, window);
const thPosts = await thProvider.fetchMedia(ctx, { since: '2023-01-01', until: '2026-07-31' });

check('fixture output is deterministic for a given seed', async () => {
  const again = await new FixtureProvider('INSTAGRAM', { asOf, seed: 'demo', historyDays: 120 }).fetchMedia(ctx, window);
  expect(igPosts.ok && again.ok, 'both runs should succeed');
  if (!igPosts.ok || !again.ok) return;
  expect(
    JSON.stringify(igPosts.data) === JSON.stringify(again.data),
    'the same seed must produce byte-identical fixture data',
  );
});

check('a different seed produces different data', async () => {
  const other = await new FixtureProvider('INSTAGRAM', { asOf, seed: 'other', historyDays: 120 }).fetchMedia(ctx, window);
  expect(igPosts.ok && other.ok, 'both runs should succeed');
  if (!igPosts.ok || !other.ok) return;
  expect(JSON.stringify(igPosts.data) !== JSON.stringify(other.data), 'seeds must actually vary the output');
});

check('Threads fixture data never predates the platform epoch', () => {
  expect(thPosts.ok, 'Threads fetch should succeed');
  if (!thPosts.ok) return;
  expect(thPosts.data.length > 0, 'expected some Threads posts');
  const earliest = thPosts.data.reduce((min, p) => (p.publishedAt < min ? p.publishedAt : min), thPosts.data[0]!.publishedAt);
  expect(earliest >= '2024-04-13', `Threads data cannot predate 2024-04-13, got ${earliest}`);
});

check('fixture data contains the awkward states the UI must handle', () => {
  expect(igPosts.ok, 'Instagram fetch should succeed');
  if (!igPosts.ok) return;
  const posts = igPosts.data;
  expect(posts.length > 30, `expected a usable history, got ${posts.length} posts`);
  expect(posts.some((p) => p.metrics.reach === null), 'expected posts with missing reach, to exercise the fallback');
  expect(posts.some((p) => p.metrics.views === 0), 'expected zero-view posts, to exercise ZERO_DENOMINATOR');
  expect(posts.some((p) => p.mediaType === 'IG_CAROUSEL'), 'expected a scarce carousel cohort');

  const carousels = posts.filter((p) => p.mediaType === 'IG_CAROUSEL').length;
  const reels = posts.filter((p) => p.mediaType === 'IG_REEL').length;
  expect(reels >= 8, `expected a scorable reel cohort, got ${reels}`);
  expect(carousels < reels, 'the carousel cohort should stay scarcer than reels');
});

check('fixture posts flow through the formulas without exceptions', () => {
  expect(igPosts.ok, 'Instagram fetch should succeed');
  if (!igPosts.ok) return;

  let calculable = 0;
  let unavailable = 0;
  for (const post of igPosts.data) {
    const result = instagramEngagementRate({ ...post.metrics, hasInsightsScope: true });
    if (isCalculable(result)) calculable += 1;
    else unavailable += 1;
  }
  expect(calculable > 0, 'expected some calculable rates');
  expect(unavailable > 0, 'expected some Not Calculable rates, since the fixture includes zero-view posts');
});

check('a real cohort from fixture data scores within bounds', () => {
  expect(igPosts.ok, 'Instagram fetch should succeed');
  if (!igPosts.ok) return;

  const reels = igPosts.data.filter((p) => p.mediaType === 'IG_REEL');
  const members: CohortMember[] = reels.map((p) => ({
    mediaPostId: p.platformMediaId,
    engagementRate: instagramEngagementRate({ ...p.metrics, hasInsightsScope: true }),
  }));
  const result = performanceIndexForCohort({ ...cohortKey, mediaType: 'IG_REEL' }, members);

  for (const value of result.indices.values()) {
    if (isCalculable(value)) {
      expect(value.value >= 0 && value.value <= 100, `index out of bounds: ${value.value}`);
    }
  }
});

check('Threads audience insights are withheld below the demographics threshold', async () => {
  const small = new FixtureProvider('THREADS', { asOf, seed: 'tiny-account', historyDays: 60 });
  const account = await small.fetchAccount(ctx);
  const audience = await small.fetchAudienceInsights(ctx, window);
  expect(account.ok && audience.ok, 'both calls should succeed');
  if (!account.ok || !audience.ok) return;
  const followers = account.data.followersCount ?? 0;
  if (followers < 100) {
    expect(audience.data.length === 0, 'demographics must be withheld below 100 followers');
  } else {
    expect(audience.data.length > 0, 'demographics should be present above the threshold');
  }
});

check('capabilities report why a feature is unavailable', () => {
  const caps = thProvider.capabilities(ctx);
  expect(!caps.canDiscoverCompetitors, 'Threads must never claim competitor discovery');
  expect(
    (caps.unavailableReasons.canDiscoverCompetitors ?? '').length > 0,
    'an unavailable capability must carry its reason for the empty state',
  );

  const noScope = igProvider.capabilities({ ...ctx, grantedScopes: [] });
  expect(!noScope.canReadMediaInsights, 'insights must be off without the scope');
  expect(!noScope.canDiscoverCompetitors, 'discovery must be off without the Facebook Login grant');
});

// ---------------------------------------------------------------------------
// Competitor scope (ADR-0001, spec 3.2)
// ---------------------------------------------------------------------------

const competitors = new FixtureCompetitorProvider({ asOf, seed: 'demo' });

check('competitor media carries public engagement only', async () => {
  const result = await competitors.lookup(ctx, '@rival.studio');
  expect(result.ok, 'lookup should succeed');
  if (!result.ok || result.data.eligibility !== 'ELIGIBLE') throw new Error('expected an eligible target');

  const forbidden = ['reach', 'saves', 'shares', 'views', 'impressions', 'profileViews'];
  for (const media of result.data.media) {
    const keys = Object.keys(media.metrics);
    expect(
      keys.length === 2 && keys.includes('likes') && keys.includes('comments'),
      `competitor metrics must be likes and comments only, found: ${keys.join(', ')}`,
    );
    for (const key of forbidden) {
      expect(!(key in media.metrics), `owner-only metric leaked into competitor data: ${key}`);
    }
  }
});

check('ineligible competitor targets are distinguished', async () => {
  const cases: Array<[string, string]> = [
    ['private_account', 'TARGET_PRIVATE'],
    ['personal_someone', 'TARGET_NOT_PROFESSIONAL'],
    ['unknown_handle', 'TARGET_NOT_FOUND'],
  ];
  for (const [handle, expected] of cases) {
    const result = await competitors.lookup(ctx, handle);
    expect(result.ok, `lookup of ${handle} should return a result, not an error`);
    if (!result.ok) continue;
    expect(result.data.eligibility === expected, `expected ${expected} for ${handle}, got ${result.data.eligibility}`);
    if (result.data.eligibility !== 'ELIGIBLE') {
      expect(result.data.explanation.length > 0, `${handle} needs an explanation for its empty state`);
    }
  }
});

check('Threads competitor lookup is refused before any network call', async () => {
  const { lookupThreadsCompetitor } = await import('../src/lib/platform/fixture/provider.js');
  const result = lookupThreadsCompetitor();
  expect(!result.ok, 'Threads competitor lookup must not succeed');
  if (result.ok) return;
  expect(result.error.code === 'NO_OFFICIAL_SOURCE', `got ${result.error.code}`);
  expect(result.error.userAction.length > 0, 'the refusal must offer an alternative');
});

// ---------------------------------------------------------------------------

await report('Core metric behaviour and fixture provider verified.');
