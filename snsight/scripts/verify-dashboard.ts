/**
 * Executable checks for the dashboard view model.
 *
 * These check the mandatory UX requirements in spec section 7 as properties of the data: that every
 * metric carries a definition tooltip, that every empty state explains itself and offers an action,
 * that change is legible without colour, that a chart point resolves to the content behind it, and
 * that nothing incomparable is pooled across platforms (spec 6.4).
 *
 * Run with `bun scripts/verify-dashboard.ts`.
 */

import {
  buildAllContentRows,
  buildChangeIndicator,
  buildDashboard,
  loadFixtureDashboard,
  resolveDrilldown,
  sortRows,
  type ContentRow,
  type DashboardInput,
  type DashboardPostInput,
  type DashboardViewModel,
  type KpiCard,
  type MetricDisplay,
} from '../src/lib/dashboard/index.js';
import { instagramEngagementRate, notCalculable, REGISTRY_VERSION } from '../src/lib/metrics/index.js';
import { check, expect, report } from './harness.js';

const asOf = new Date('2026-07-31T00:00:00Z');

const input = await loadFixtureDashboard({ asOf, periodDays: 30, seed: 'demo' });
const model = buildDashboard(input);
const allRows = buildAllContentRows(input);

function allKpis(m: DashboardViewModel): KpiCard[] {
  return [...m.commonKpis, ...m.platformSections.flatMap((section) => section.kpis)];
}

/** Every metric the UI can show, including rows reachable only through drill-down. */
function allDisplays(m: DashboardViewModel): MetricDisplay[] {
  return [
    ...allKpis(m).map((card) => card.metric),
    ...allRows.flatMap((row) => [...row.nativeMetrics, row.engagementRate, row.performanceIndex]),
  ];
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

check('the dashboard builds from fixture data with both platforms', () => {
  expect(model.platformSections.length === 2, `expected 2 platform sections, got ${model.platformSections.length}`);
  expect(model.commonKpis.length >= 3, 'expected common KPI cards');
  expect(model.isDemo, 'a fixture-backed workspace must be marked as demo');
  expect(
    model.coverageNotices.some((notice) => notice.includes('generated sample data')),
    'a demo workspace must say its numbers are synthetic',
  );
});

check('the same input builds the same dashboard', () => {
  const again = buildDashboard(input);
  expect(JSON.stringify(again) === JSON.stringify(model), 'buildDashboard must be pure');
});

check('sync recency is surfaced for every account', () => {
  expect(model.syncStatus.length === 2, 'expected a sync row per account');
  for (const row of model.syncStatus) {
    expect(row.statusText.length > 0, `${row.platform} needs a status sentence`);
    expect(row.lastSuccessfulSyncAt !== null, `${row.platform} must report its last successful sync`);
  }
  // The demo sets Threads to EXPIRING_SOON, so the warning path is exercised rather than assumed.
  expect(
    model.syncStatus.some((row) => !row.isHealthy),
    'the demo should include a degraded connection so its presentation is visible',
  );
});

// ---------------------------------------------------------------------------
// Mandatory UX rules
// ---------------------------------------------------------------------------

check('every metric shown carries a definition tooltip and a provenance label', () => {
  const displays = allDisplays(model);
  expect(displays.length > 20, `expected a populated dashboard, got ${displays.length} metrics`);
  for (const display of displays) {
    expect(display.tooltip.trim().length > 20, `${display.metricKey} has no usable tooltip`);
    expect(display.labelText.length > 0, `${display.metricKey} has no provenance label`);
    expect(display.displayName.length > 0, `${display.metricKey} has no display name`);
  }
});

check('every absent value explains itself and offers an action', () => {
  const absent = allDisplays(model).filter(
    (display) => display.state === 'NOT_CALCULABLE' || display.state === 'NOT_SYNCED',
  );
  expect(absent.length > 0, 'the fixture should produce absent values, or these states are untested');
  for (const display of absent) {
    expect((display.reasonText ?? '').length > 0, `${display.metricKey} is absent with no reason`);
    expect((display.actionText ?? '').length > 0, `${display.metricKey} is absent with no corrective action`);
    expect(display.valueText === undefined, `${display.metricKey} must not carry a value while absent`);
  }
});

check('a fallback denominator is disclosed on the value', () => {
  const caveated = allDisplays(model).filter((display) => display.state === 'VALUE_WITH_CAVEAT');
  expect(caveated.length > 0, 'the fixture omits reach for some posts, so caveated values should exist');
  for (const display of caveated) {
    expect((display.caveat ?? '').includes('views'), `${display.metricKey} must name the substituted denominator`);
    expect((display.caveat ?? '').includes('comparable'), `${display.metricKey} must warn against direct comparison`);
  }
});

check('change is legible without colour', () => {
  const withChange = allKpis(model).filter((card) => card.change !== null);
  expect(withChange.length > 0, 'expected cards with a comparison');
  for (const card of withChange) {
    const change = card.change!;
    expect(change.glyph.length > 0, `${card.id} has no shape indicator`);
    expect(change.text.length > 0, `${card.id} has no change text`);
    expect(change.srText.length > 10, `${card.id} has no screen-reader sentence`);
  }
  // A metric that is itself a change carries no badge, rather than an empty comparison.
  const growth = model.commonKpis.find((card) => card.id === 'kpi.follower_growth');
  expect(growth?.change === null, 'a growth rate should not show a period comparison badge');
});

check('direction and polarity are independent', () => {
  // A shorter publishing interval is an improvement, so a downward arrow must read as positive.
  const fasterCadence = buildChangeIndicator({
    metricKey: 'account.publishing_interval_days',
    current: 2,
    previous: 3,
    comparisonLabel: 'previous 30 days',
  });
  expect(fasterCadence.direction === 'DOWN', 'interval fell, so direction is DOWN');
  expect(fasterCadence.polarity === 'POSITIVE', 'a shorter interval is an improvement');

  const fewerFollowers = buildChangeIndicator({
    metricKey: 'account.followers_count',
    current: 900,
    previous: 1000,
    comparisonLabel: 'previous 30 days',
  });
  expect(fewerFollowers.direction === 'DOWN' && fewerFollowers.polarity === 'NEGATIVE', 'losing followers is negative');
});

check('change from zero does not fabricate a percentage', () => {
  const indicator = buildChangeIndicator({
    metricKey: 'ig.media.views',
    current: 500,
    previous: 0,
    comparisonLabel: 'previous 30 days',
  });
  expect(indicator.deltaPercent === undefined, 'a percentage change from zero is undefined');
  expect(indicator.text.includes('zero'), 'the card must say the baseline was zero');
});

check('a missing comparison is stated rather than shown as flat', () => {
  const indicator = buildChangeIndicator({
    metricKey: 'ig.media.views',
    current: 500,
    previous: null,
    comparisonLabel: 'previous 30 days',
  });
  expect(indicator.direction === 'UNKNOWN', 'no baseline means unknown, not flat');
  expect(indicator.polarity === 'NEUTRAL', 'an unknown change carries no verdict');
});

// ---------------------------------------------------------------------------
// Cross-platform rules (spec 6.4)
// ---------------------------------------------------------------------------

check('no incomparable metric is pooled across platforms', () => {
  const pooled = model.commonKpis.map((card) => card.metric.metricKey);
  for (const key of pooled) {
    expect(
      !key.includes('views') && !key.includes('engagement_rate') && !key.includes('reach'),
      `${key} is platform-specific and must not appear as a combined KPI`,
    );
  }
  // Views must still be present - per platform.
  const platformKeys = model.platformSections.flatMap((section) => section.kpis.map((card) => card.metric.metricKey));
  expect(platformKeys.includes('ig.media.views'), 'Instagram views should be shown natively');
  expect(platformKeys.includes('th.media.views'), 'Threads views should be shown natively');
});

check('the pooled follower total admits it double counts people', () => {
  const followers = model.commonKpis.find((card) => card.id === 'kpi.followers');
  expect(followers !== undefined, 'expected a followers card');
  expect((followers?.footnote ?? '').includes('same person'), 'a pooled follower total must disclose double counting');
});

check('contribution is expressed on post count, not on pooled views', () => {
  const shares = model.platformSections.map((section) => section.contribution.postSharePercent);
  const total = shares.reduce((sum, value) => sum + value, 0);
  expect(Math.abs(total - 100) < 0.5, `platform shares should total 100, got ${total}`);
  for (const section of model.platformSections) {
    expect(
      section.contribution.nativeInteractionsNote.includes('side by side'),
      'contribution must explain why interactions are not summed',
    );
  }
});

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

check('a quiet day is not drawn as zero', () => {
  const section = model.platformSections[0]!;
  const quiet = section.trend.points.filter((point) => point.state === 'NO_ACTIVITY');
  expect(quiet.length > 0, 'the fixture includes a silent period, so quiet days should exist');
  for (const point of quiet) {
    expect(point.value === null, `${point.date} must have no value rather than zero`);
    expect(point.postCount === 0, `${point.date} should report no posts`);
  }
});

check('the trend covers every date in the period exactly once', () => {
  const section = model.platformSections[0]!;
  const dates = section.trend.points.map((point) => point.date);
  expect(dates.length === input.period.days, `expected ${input.period.days} points, got ${dates.length}`);
  expect(new Set(dates).size === dates.length, 'dates must not repeat');
  expect(dates[0] === input.period.start, `series should start at ${input.period.start}`);
  expect(dates[dates.length - 1] === input.period.end, `series should end at ${input.period.end}`);
});

check('dates before coverage are marked outside coverage, not zero', () => {
  // Built synthetically: the fixture accounts have long histories, so this state needs constructing.
  const synthetic = syntheticInput({ coverageStartsAt: '2026-07-20' });
  const built = buildDashboard(synthetic);
  const points = built.platformSections[0]!.trend.points;
  const outside = points.filter((point) => point.state === 'OUTSIDE_COVERAGE');

  expect(outside.length > 0, 'expected dates before the coverage start');
  for (const point of outside) {
    expect(point.date < '2026-07-20', `${point.date} is inside coverage and should not be marked outside`);
    expect(point.value === null, 'an uncovered date must have no value');
  }
  expect(built.platformSections[0]!.trend.uncoveredDates.length === outside.length, 'uncovered dates must be listed');
  expect(
    (built.platformSections[0]!.coverageNotice ?? '').includes('2026-07-20'),
    'the section must state when coverage begins',
  );
});

check('the Threads coverage notice names the platform limit', () => {
  const synthetic = syntheticInput({ coverageStartsAt: '2026-07-20', platform: 'THREADS' });
  const built = buildDashboard(synthetic);
  expect(
    (built.platformSections[0]!.coverageNotice ?? '').includes('13 April 2024'),
    'a Threads coverage notice should explain the platform epoch',
  );
});

// ---------------------------------------------------------------------------
// Drill-down (FR-009)
// ---------------------------------------------------------------------------

const rows: ContentRow[] = [...model.bestContent, ...model.worstContent];

check('every KPI that content can explain offers a drill-down', () => {
  for (const card of model.platformSections.flatMap((section) => section.kpis)) {
    expect(card.drilldown !== null, `${card.id} should resolve to content`);
    expect(card.drilldown?.platform === card.platform, `${card.id} drill-down must inherit its platform`);
  }
  // A follower total is not explained by a post, so it deliberately has none.
  expect(model.commonKpis.find((card) => card.id === 'kpi.followers')?.drilldown === null, 'followers need no drill-down');
});

check('clicking a chart point returns only that date', () => {
  const section = model.platformSections[0]!;
  const active = section.trend.points.find((point) => point.state === 'VALUE');
  expect(active !== undefined, 'expected an active date');
  const date = active!.date;

  const result = resolveDrilldown({
    ref: section.kpis[0]!.drilldown!,
    rows: allRows,
    onDate: date,
  });

  expect(result.rows.length > 0, `expected posts on ${date}`);
  for (const row of result.rows) {
    expect(row.publishedAt.slice(0, 10) === date, `${row.mediaPostId} is not from ${date}`);
    expect(row.platform === section.platform, 'the platform filter must be applied');
  }
  expect(result.appliedFilters.includes(date), 'the filters shown must include the date');
});

check('a date with no content produces an explained empty state', () => {
  const section = model.platformSections[0]!;
  const quiet = section.trend.points.find((point) => point.state === 'NO_ACTIVITY');
  expect(quiet !== undefined, 'expected a quiet date');

  const result = resolveDrilldown({
    ref: section.kpis[0]!.drilldown!,
    rows: allRows,
    onDate: quiet!.date,
  });

  expect(result.rows.length === 0, 'a quiet date has no content');
  expect(result.emptyState !== undefined, 'an empty result needs an empty state');
  expect((result.emptyState?.action ?? '').length > 0, 'the empty state must offer a way forward');
});

check('sorting never treats an unavailable metric as zero', () => {
  const withGap: ContentRow[] = [
    syntheticRow('low', 1.2),
    syntheticRow('high', 42),
    syntheticRow('unknown', null),
    syntheticRow('mid', 9),
  ];
  const sorted = sortRows(withGap, 'ENGAGEMENT_RATE');
  expect(sorted[0]?.mediaPostId === 'high', 'highest rate should lead');
  expect(sorted[sorted.length - 1]?.mediaPostId === 'unknown', 'an unavailable rate must sort last, not lowest');
  expect(sorted[1]?.mediaPostId === 'mid' && sorted[2]?.mediaPostId === 'low', 'the remainder should stay ordered');
});

check('drill-down respects the platform filter', () => {
  const threads = model.platformSections.find((section) => section.platform === 'THREADS')!;
  const result = resolveDrilldown({ ref: threads.kpis[0]!.drilldown!, rows: allRows });
  expect(result.rows.length > 0, 'expected Threads content');
  expect(
    result.rows.every((row) => row.platform === 'THREADS'),
    'Instagram content must not appear under a Threads figure',
  );
});

// ---------------------------------------------------------------------------
// Ranking and AI panel
// ---------------------------------------------------------------------------

check('content ranking is ordered and only includes scored posts', () => {
  expect(model.bestContent.length > 0, 'expected ranked content');
  for (const row of [...model.bestContent, ...model.worstContent]) {
    expect(row.performanceIndex.state === 'VALUE', 'ranked content must have a calculable index');
  }
  const values = model.bestContent.map((row) => row.performanceIndex.rawValue ?? 0);
  for (let i = 1; i < values.length; i += 1) {
    expect(values[i - 1]! >= values[i]!, 'best content must be ordered by index descending');
  }
  expect(model.rankingNote.includes('same type'), 'the note must explain what the index compares');
});

check('unranked posts are counted rather than hidden', () => {
  expect(
    model.rankingNote.includes('unranked') || model.rankingNote.includes('fewer than 8'),
    'posts excluded from ranking must be disclosed',
  );
});

check('native metrics accompany the index, so a high score cannot mislead', () => {
  for (const row of model.bestContent) {
    expect(row.nativeMetrics.length >= 4, 'ranked content must show its native metrics');
    expect(row.excerpt.length > 0, 'ranked content needs a preview excerpt');
  }
});

check('the AI panel is pending, evidence-free, and still states confidence', () => {
  const panel = model.aiSummary;
  expect(panel.state === 'PENDING', 'no model call may happen in a dashboard request');
  expect(panel.text === undefined, 'a pending panel has no narrative');
  expect(panel.evidence.length === 0, 'evidence is only meaningful attached to a claim');
  expect(['HIGH', 'MEDIUM', 'LOW'].includes(panel.confidence), 'confidence must be present before the model runs');
  expect(panel.confidenceRationale.length > 0, 'confidence must be justified, not asserted');
  expect(panel.postsAnalyzed > 0, 'the evidence base must be quantified');
  expect(panel.windowStart === input.period.start && panel.windowEnd === input.period.end, 'the window must be stated');
  expect(panel.stateExplanation.length > 0, 'a pending state must explain itself');
});

check('recommended actions are rule-based and marked as hypotheses', () => {
  expect(model.nextActions.length > 0, 'expected at least one recommended action');
  for (const action of model.nextActions) {
    expect(action.rationale.length > 20, `${action.id} needs a rationale`);
    if (action.isHypothesis) {
      expect(action.title.length > 0, `${action.id} needs a title`);
    }
  }
  const formatAction = model.nextActions.find((action) => action.id === 'action.lean_into_format');
  if (formatAction) {
    expect(formatAction.evidenceCount >= 8, 'a format recommendation needs a scorable cohort behind it');
  }
});

// ---------------------------------------------------------------------------
// Aggregation honesty
// ---------------------------------------------------------------------------

check('period aggregates disclose the posts they excluded', () => {
  // One complete post and one missing saves. The interaction total must cover the complete post only
  // and say so, rather than summing the terms that happen to be present.
  const complete = syntheticPost('complete', { likes: 100, comments: 10, saves: 5, shares: 5, views: 1000, reach: 900 });
  const incomplete: DashboardPostInput = {
    ...syntheticPost('incomplete', { likes: 80, comments: 4, saves: 0, shares: 2, views: 900, reach: 800 }),
    saves: null,
  };

  const built = buildDashboard(syntheticInput({ coverageStartsAt: null, posts: [complete, incomplete] }));
  const cards = built.platformSections[0]!.kpis;
  const interactions = cards.find((card) => card.metric.metricKey === 'ig.media.interactions')!;

  expect(interactions.metric.rawValue === 120, `expected only the complete post's 120 interactions, got ${interactions.metric.rawValue}`);
  expect((interactions.footnote ?? '').includes('1 of 2'), `expected an exclusion note, got: ${interactions.footnote}`);

  const engagement = cards.find((card) => card.metric.metricKey === 'ig.media.engagement_rate')!;
  expect((engagement.footnote ?? '').includes('excluded'), 'the engagement rate must disclose exclusions too');
});

check('an engagement rate is not the mean of per-post rates', () => {
  // Two posts, one small and one large. A mean of rates gives 15%; weighting by views gives ~5.9%.
  const posts: DashboardPostInput[] = [
    syntheticPost('small', { likes: 20, comments: 5, saves: 0, shares: 0, views: 100, reach: 100 }),
    syntheticPost('large', { likes: 90, comments: 10, saves: 0, shares: 0, views: 2000, reach: 1900 }),
  ];
  const built = buildDashboard(syntheticInput({ coverageStartsAt: null, posts }));
  const card = built.platformSections[0]!.kpis.find((k) => k.metric.metricKey === 'ig.media.engagement_rate')!;
  const value = card.metric.rawValue ?? 0;
  // (125 interactions) / (2000 reach) x 100 = 6.25
  expect(Math.abs(value - 6.25) < 0.01, `expected a view-weighted 6.25%, got ${value}`);
});

await report('Dashboard view model and drill-down verified.');

// ---------------------------------------------------------------------------
// Synthetic fixtures for states the generated data does not reliably produce
// ---------------------------------------------------------------------------

function syntheticPost(
  id: string,
  metrics: { likes: number; comments: number; saves: number; shares: number; views: number; reach: number | null },
): DashboardPostInput {
  return {
    mediaPostId: id,
    mediaType: 'IG_IMAGE',
    publishedAt: '2026-07-25T10:00:00.000Z',
    caption: `synthetic ${id}`,
    permalink: null,
    thumbnailUrl: null,
    childMediaUrls: [],
    likes: metrics.likes,
    comments: metrics.comments,
    saves: metrics.saves,
    shares: metrics.shares,
    views: metrics.views,
    reach: metrics.reach,
    replies: null,
    reposts: null,
    quotes: null,
    engagementRate: instagramEngagementRate({ ...metrics, hasInsightsScope: true }),
  };
}

function syntheticInput(options: {
  coverageStartsAt: string | null;
  platform?: 'INSTAGRAM' | 'THREADS';
  posts?: readonly DashboardPostInput[];
}): DashboardInput {
  return {
    isDemo: false,
    period: { start: '2026-07-01', end: '2026-07-31', label: 'Last 31 days', days: 31 },
    comparison: { start: '2026-05-31', end: '2026-06-30', label: 'previous 31 days', days: 31 },
    generatedAt: '2026-07-31T00:00:00.000Z',
    accounts: [
      {
        platform: options.platform ?? 'INSTAGRAM',
        username: 'synthetic.account',
        lastSuccessfulSyncAt: '2026-07-31T00:00:00.000Z',
        connectionStatus: 'ACTIVE',
        dataCoverageStartsAt: options.coverageStartsAt,
        followersAtPeriodStart: 1000,
        followersAtPeriodEnd: 1100,
        followersAtComparisonStart: 950,
        posts: options.posts ?? [],
        comparisonPosts: [],
        cohortPosts: options.posts ?? [],
      },
    ],
  };
}

function syntheticRow(id: string, engagementRate: number | null): ContentRow {
  const value = engagementRate === null
    ? notCalculable({
        metricKey: 'ig.media.engagement_rate',
        reason: 'MISSING_DENOMINATOR',
        unit: 'PERCENT',
        label: 'CALCULATED',
        formulaVersion: REGISTRY_VERSION,
      })
    : instagramEngagementRate({ likes: engagementRate * 10, comments: 0, saves: 0, shares: 0, reach: 1000 });

  return {
    mediaPostId: id,
    platform: 'INSTAGRAM',
    mediaType: 'IG_IMAGE',
    publishedAt: '2026-07-20T10:00:00.000Z',
    excerpt: id,
    permalink: null,
    thumbnailUrl: null,
    childMediaUrls: [],
    nativeMetrics: [],
    engagementRate: {
      metricKey: 'ig.media.engagement_rate',
      displayName: 'Engagement rate',
      state: engagementRate === null ? 'NOT_CALCULABLE' : 'VALUE',
      label: 'CALCULATED',
      labelText: 'Calculated',
      tooltip: 'test',
      valueText: engagementRate === null ? undefined : `${engagementRate}%`,
      rawValue: value.kind === 'value' ? value.value : undefined,
    },
    performanceIndex: {
      metricKey: 'content.performance_index',
      displayName: 'Performance index',
      state: 'NOT_CALCULABLE',
      label: 'CALCULATED',
      labelText: 'Calculated',
      tooltip: 'test',
      reason: 'INSUFFICIENT_SAMPLE',
      reasonText: 'test',
      actionText: 'test',
    },
  };
}

