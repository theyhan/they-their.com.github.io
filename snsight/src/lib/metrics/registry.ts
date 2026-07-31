/**
 * The metric registry.
 *
 * ADR-0003 decision 1: metrics are defined here, once, and seeded into `metric_definitions`.
 * Application code resolves definitions through this module and never inlines arithmetic. This is
 * the section 15 mitigation for API metric deprecation, and it only works while there is no second
 * definition site.
 *
 * Adding a metric means adding a definition here plus a calculator in `formulas.ts`; the check in
 * `assertRegistryIntegrity` fails the build if a definition names inputs that do not exist.
 */

import type { MetricLabel, MetricScope, MetricUnit } from './types.js';

/** Bumped whenever a formula changes. Persisted with every stored value so FR-013 can freeze it. */
export const REGISTRY_VERSION = '2026.08.0';

export interface MetricDefinition {
  readonly key: string;
  /** Null for cross-platform metrics such as follower growth rate. */
  readonly platform: 'INSTAGRAM' | 'THREADS' | null;
  readonly scope: MetricScope;
  readonly label: MetricLabel;
  readonly unit: MetricUnit;
  readonly displayName: string;
  /** Shown in the mandatory metric tooltip. */
  readonly description: string;
  /** Human-readable formula. Null for raw API metrics. */
  readonly formula: string | null;
  /** Keys consumed by this metric. Empty for raw API metrics. */
  readonly requiredInputs: readonly string[];
  /** Preferred then fallback, in order. Empty for metrics without a denominator. */
  readonly denominatorPreference: readonly string[];
  /**
   * Earliest date for which the platform can supply this metric at all. Threads data does not
   * predate 2024-04-13, so trend requests before then are NOT_YET_COLLECTED rather than empty.
   */
  readonly availableFrom?: string;
  readonly notes?: string;
}

const IG = 'INSTAGRAM' as const;
const TH = 'THREADS' as const;

/** Threads has no data before this date, per the platform metric reference cited in ADR-0003. */
export const THREADS_DATA_EPOCH = '2024-04-13';

/** Threads follower demographics require at least this many followers. */
export const THREADS_DEMOGRAPHICS_MIN_FOLLOWERS = 100;

const RAW: MetricDefinition[] = [
  // -- Instagram raw media metrics -----------------------------------------------------------
  {
    key: 'ig.media.likes',
    platform: IG,
    scope: 'MEDIA',
    label: 'RAW_API_METRIC',
    unit: 'COUNT',
    displayName: 'Likes',
    description: 'Likes on the post, as reported by Instagram.',
    formula: null,
    requiredInputs: [],
    denominatorPreference: [],
  },
  {
    key: 'ig.media.comments',
    platform: IG,
    scope: 'MEDIA',
    label: 'RAW_API_METRIC',
    unit: 'COUNT',
    displayName: 'Comments',
    description: 'Comments on the post, as reported by Instagram.',
    formula: null,
    requiredInputs: [],
    denominatorPreference: [],
  },
  {
    key: 'ig.media.saves',
    platform: IG,
    scope: 'MEDIA',
    label: 'RAW_API_METRIC',
    unit: 'COUNT',
    displayName: 'Saves',
    description: 'How many people saved the post. Reported only to the account owner, so it is never shown for a competitor.',
    formula: null,
    requiredInputs: [],
    denominatorPreference: [],
    notes: 'Owner-only per spec 3.2.',
  },
  {
    key: 'ig.media.shares',
    platform: IG,
    scope: 'MEDIA',
    label: 'RAW_API_METRIC',
    unit: 'COUNT',
    displayName: 'Shares',
    description: 'How many times the post was shared. Reported only to the account owner, so it is never shown for a competitor.',
    formula: null,
    requiredInputs: [],
    denominatorPreference: [],
    notes: 'Owner-only per spec 3.2.',
  },
  {
    key: 'ig.media.views',
    platform: IG,
    scope: 'MEDIA',
    label: 'RAW_API_METRIC',
    unit: 'COUNT',
    displayName: 'Views',
    description:
      'Plays or views of the post. Recent Instagram API versions consolidated older impression-style metrics into views, which is why this definition carries an availability window.',
    formula: null,
    requiredInputs: [],
    denominatorPreference: [],
  },
  {
    key: 'ig.media.reach',
    platform: IG,
    scope: 'MEDIA',
    label: 'RAW_API_METRIC',
    unit: 'COUNT',
    displayName: 'Reach',
    description:
      'Unique accounts that saw the post. Owner-only, and the preferred denominator for Instagram rates.',
    formula: null,
    requiredInputs: [],
    denominatorPreference: [],
  },

  // -- Instagram calculated metrics ----------------------------------------------------------
  {
    key: 'ig.media.engagement_rate',
    platform: IG,
    scope: 'MEDIA',
    label: 'CALCULATED',
    unit: 'PERCENT',
    displayName: 'Engagement rate',
    description:
      'The share of accounts that saw the post and then interacted with it. Instagram and Threads engagement rates are calculated differently and are not directly comparable.',
    formula: '(likes + comments + saves + shares) / reach x 100',
    requiredInputs: ['ig.media.likes', 'ig.media.comments', 'ig.media.saves', 'ig.media.shares'],
    denominatorPreference: ['ig.media.reach', 'ig.media.views'],
    notes: 'Falls back to views when reach is unavailable; the fallback is disclosed on the value.',
  },
  {
    key: 'ig.media.save_rate',
    platform: IG,
    scope: 'MEDIA',
    label: 'CALCULATED',
    unit: 'PERCENT',
    displayName: 'Save rate',
    description: 'How often the people who saw the post went on to save it. Measured against reach only, so it is unavailable when reach is not reported.',
    formula: 'saves / reach x 100',
    requiredInputs: ['ig.media.saves'],
    denominatorPreference: ['ig.media.reach'],
  },
  {
    key: 'ig.media.share_rate',
    platform: IG,
    scope: 'MEDIA',
    label: 'CALCULATED',
    unit: 'PERCENT',
    displayName: 'Share rate',
    description: 'How often the people who saw the post went on to share it.',
    formula: 'shares / reach x 100',
    requiredInputs: ['ig.media.shares'],
    denominatorPreference: ['ig.media.reach'],
  },
  {
    key: 'ig.media.view_rate',
    platform: IG,
    scope: 'MEDIA',
    label: 'CALCULATED',
    unit: 'PERCENT',
    displayName: 'View rate',
    description:
      'Views against followers at publication. Requires a snapshot from the publication date, so posts predating collection return Not Calculable.',
    formula: 'views / followers at posting time x 100',
    requiredInputs: ['ig.media.views'],
    denominatorPreference: ['account.followers_at_publish'],
  },
  {
    key: 'ig.media.non_follower_reach_share',
    platform: IG,
    scope: 'MEDIA',
    label: 'CALCULATED',
    unit: 'PERCENT',
    displayName: 'Non-follower reach share',
    description: 'How much of the post\'s reach came from people who do not follow the account. A high share can mean strong distribution or weak resonance with existing followers, so it is shown without a verdict.',
    formula: 'non-follower reach / total reach x 100',
    requiredInputs: ['ig.media.reach'],
    denominatorPreference: ['ig.media.reach'],
  },

  // -- Threads raw media metrics -------------------------------------------------------------
  {
    key: 'th.media.likes',
    platform: TH,
    scope: 'MEDIA',
    label: 'RAW_API_METRIC',
    unit: 'COUNT',
    displayName: 'Likes',
    description: 'Likes on the thread.',
    formula: null,
    requiredInputs: [],
    denominatorPreference: [],
    availableFrom: THREADS_DATA_EPOCH,
  },
  {
    key: 'th.media.replies',
    platform: TH,
    scope: 'MEDIA',
    label: 'RAW_API_METRIC',
    unit: 'COUNT',
    displayName: 'Replies',
    description: 'Replies to the thread.',
    formula: null,
    requiredInputs: [],
    denominatorPreference: [],
    availableFrom: THREADS_DATA_EPOCH,
  },
  {
    key: 'th.media.reposts',
    platform: TH,
    scope: 'MEDIA',
    label: 'RAW_API_METRIC',
    unit: 'COUNT',
    displayName: 'Reposts',
    description: 'Reposts of the thread.',
    formula: null,
    requiredInputs: [],
    denominatorPreference: [],
    availableFrom: THREADS_DATA_EPOCH,
  },
  {
    key: 'th.media.quotes',
    platform: TH,
    scope: 'MEDIA',
    label: 'RAW_API_METRIC',
    unit: 'COUNT',
    displayName: 'Quotes',
    description: 'Quote posts referencing the thread.',
    formula: null,
    requiredInputs: [],
    denominatorPreference: [],
    availableFrom: THREADS_DATA_EPOCH,
  },
  {
    key: 'th.media.views',
    platform: TH,
    scope: 'MEDIA',
    label: 'RAW_API_METRIC',
    unit: 'COUNT',
    displayName: 'Views',
    description:
      'How many times the thread was viewed. Threads reports views rather than reach, so this figure is never added to an Instagram reach total.',
    formula: null,
    requiredInputs: [],
    denominatorPreference: [],
    availableFrom: THREADS_DATA_EPOCH,
  },

  // -- Threads calculated metrics ------------------------------------------------------------
  {
    key: 'th.media.engagement_rate',
    platform: TH,
    scope: 'MEDIA',
    label: 'CALCULATED',
    unit: 'PERCENT',
    displayName: 'Engagement rate',
    description: 'The share of views that produced any interaction: a like, reply, repost or quote.',
    formula: '(likes + replies + reposts + quotes) / views x 100',
    requiredInputs: ['th.media.likes', 'th.media.replies', 'th.media.reposts', 'th.media.quotes'],
    denominatorPreference: ['th.media.views'],
    availableFrom: THREADS_DATA_EPOCH,
  },
  {
    key: 'th.media.reply_rate',
    platform: TH,
    scope: 'MEDIA',
    label: 'CALCULATED',
    unit: 'PERCENT',
    displayName: 'Reply rate',
    description: 'How often a view turned into a reply. The clearest signal that a thread started a conversation.',
    formula: 'replies / views x 100',
    requiredInputs: ['th.media.replies'],
    denominatorPreference: ['th.media.views'],
    availableFrom: THREADS_DATA_EPOCH,
  },
  {
    key: 'th.media.repost_rate',
    platform: TH,
    scope: 'MEDIA',
    label: 'CALCULATED',
    unit: 'PERCENT',
    displayName: 'Repost rate',
    description: 'How often a view turned into a repost, carrying the thread to another audience unchanged.',
    formula: 'reposts / views x 100',
    requiredInputs: ['th.media.reposts'],
    denominatorPreference: ['th.media.views'],
    availableFrom: THREADS_DATA_EPOCH,
  },
  {
    key: 'th.media.quote_rate',
    platform: TH,
    scope: 'MEDIA',
    label: 'CALCULATED',
    unit: 'PERCENT',
    displayName: 'Quote rate',
    description: 'How often a view turned into a quote post, where someone added their own commentary.',
    formula: 'quotes / views x 100',
    requiredInputs: ['th.media.quotes'],
    denominatorPreference: ['th.media.views'],
    availableFrom: THREADS_DATA_EPOCH,
  },
  {
    key: 'th.media.conversation_spread_rate',
    platform: TH,
    scope: 'MEDIA',
    label: 'CALCULATED',
    unit: 'PERCENT',
    displayName: 'Conversation spread rate',
    description: 'The share of views that produced an interaction which spreads the thread further - a reply, repost or quote - rather than only acknowledging it with a like.',
    formula: '(replies + reposts + quotes) / views x 100',
    requiredInputs: ['th.media.replies', 'th.media.reposts', 'th.media.quotes'],
    denominatorPreference: ['th.media.views'],
    availableFrom: THREADS_DATA_EPOCH,
  },

  // -- Threads account-scope metrics ---------------------------------------------------------
  {
    key: 'th.account.clicks',
    platform: TH,
    scope: 'ACCOUNT',
    label: 'RAW_API_METRIC',
    unit: 'COUNT',
    displayName: 'Link clicks',
    description:
      'Link clicks across the account for the period. Threads reports clicks for the account only, not for individual posts.',
    notes: 'Account scope only; see ADR-0003 decision 5.',
    formula: null,
    requiredInputs: [],
    denominatorPreference: [],
    availableFrom: THREADS_DATA_EPOCH,
  },
  {
    key: 'th.account.click_through_rate',
    platform: TH,
    scope: 'ACCOUNT',
    label: 'CALCULATED',
    unit: 'PERCENT',
    displayName: 'Click-through rate',
    description:
      'The share of account views that resulted in a link click. Available for the account as a whole; Threads does not report clicks for individual posts.',
    notes: 'Amends spec 6.3, which defined this per post.',
    formula: 'account link clicks / account views x 100',
    requiredInputs: ['th.account.clicks'],
    denominatorPreference: ['th.account.views'],
    availableFrom: THREADS_DATA_EPOCH,
  },
  {
    key: 'th.account.views',
    platform: TH,
    scope: 'ACCOUNT',
    label: 'RAW_API_METRIC',
    unit: 'COUNT',
    displayName: 'Account views',
    description: 'Views across the account for the period.',
    formula: null,
    requiredInputs: [],
    denominatorPreference: [],
    availableFrom: THREADS_DATA_EPOCH,
  },

  // -- Interaction totals (FR-003 KPI cards) -------------------------------------------------
  // Defined per platform rather than once, because the terms differ. A single pooled "interactions"
  // number across both platforms would breach spec 6.4.
  {
    key: 'ig.media.interactions',
    platform: IG,
    scope: 'MEDIA',
    label: 'CALCULATED',
    unit: 'COUNT',
    displayName: 'Interactions',
    description: 'Sum of Instagram interactions on the post. Saves and shares are owner-only, so this is unavailable for competitors.',
    formula: 'likes + comments + saves + shares',
    requiredInputs: ['ig.media.likes', 'ig.media.comments', 'ig.media.saves', 'ig.media.shares'],
    denominatorPreference: [],
  },
  {
    key: 'th.media.interactions',
    platform: TH,
    scope: 'MEDIA',
    label: 'CALCULATED',
    unit: 'COUNT',
    displayName: 'Interactions',
    description: 'Sum of Threads interactions on the post.',
    formula: 'likes + replies + reposts + quotes',
    requiredInputs: ['th.media.likes', 'th.media.replies', 'th.media.reposts', 'th.media.quotes'],
    denominatorPreference: [],
    availableFrom: THREADS_DATA_EPOCH,
  },

  // -- Cross-platform metrics ----------------------------------------------------------------
  {
    key: 'account.post_count',
    platform: null,
    scope: 'ACCOUNT',
    label: 'CALCULATED',
    unit: 'COUNT',
    displayName: 'Posts published',
    description:
      'Posts published inside the selected period. Counted from collected media, so it can differ from the platform profile total when the period predates collection.',
    formula: 'count of posts published within the period',
    requiredInputs: [],
    denominatorPreference: [],
  },
  {
    key: 'account.followers_count',
    platform: null,
    scope: 'ACCOUNT',
    label: 'RAW_API_METRIC',
    unit: 'COUNT',
    displayName: 'Followers',
    description: 'Followers at the end of the selected period.',
    formula: null,
    requiredInputs: [],
    denominatorPreference: [],
  },
  {
    key: 'account.followers_at_publish',
    platform: null,
    scope: 'ACCOUNT',
    label: 'ESTIMATE',
    unit: 'COUNT',
    displayName: 'Followers at publication',
    description:
      'Resolved from the daily snapshot nearest the publication date. An estimate, because platforms do not report historical follower counts.',
    formula: null,
    requiredInputs: [],
    denominatorPreference: [],
  },
  {
    key: 'account.follower_growth_rate',
    platform: null,
    scope: 'ACCOUNT',
    label: 'CALCULATED',
    unit: 'PERCENT',
    displayName: 'Follower growth rate',
    description: 'How much the follower count grew or shrank across the selected period.',
    formula: '(ending followers - starting followers) / starting followers x 100',
    requiredInputs: ['account.followers_count'],
    denominatorPreference: ['account.followers_count'],
  },
  {
    key: 'account.publishing_interval_days',
    platform: null,
    scope: 'ACCOUNT',
    label: 'CALCULATED',
    unit: 'DAYS',
    displayName: 'Publishing interval',
    description: 'The average number of days between posts across the selected period. A lower number means more frequent publishing.',
    formula: 'days in period / number of posts',
    requiredInputs: [],
    denominatorPreference: ['account.post_count'],
  },
  {
    key: 'account.follower_interaction_rate',
    platform: null,
    scope: 'MEDIA',
    label: 'ESTIMATE',
    unit: 'PERCENT',
    displayName: 'Follower interaction rate',
    description:
      'Public interactions measured against the follower count at the time of posting. An estimate, because historical follower counts are interpolated between daily snapshots. Used for competitor comparison, where public interactions are the only data available.',
    formula: 'public interactions / estimated followers at posting time x 100',
    requiredInputs: [],
    denominatorPreference: ['account.followers_at_publish'],
  },
  {
    key: 'content.performance_index',
    platform: null,
    scope: 'MEDIA',
    label: 'CALCULATED',
    unit: 'INDEX',
    displayName: 'Performance index',
    description:
      'How this post ranks against the same account\'s other posts of the same type over the last 90 days, from 0 to 100. It needs at least 8 comparable posts. This is relative to this account only, not a measure of absolute quality.',
    formula: 'midrank percentile of engagement rate within cohort, scaled 0-100',
    requiredInputs: ['ig.media.engagement_rate', 'th.media.engagement_rate'],
    denominatorPreference: [],
  },
];

export const METRIC_DEFINITIONS: readonly MetricDefinition[] = Object.freeze(RAW);

const BY_KEY = new Map<string, MetricDefinition>(RAW.map((d) => [d.key, d]));

export function getMetricDefinition(key: string): MetricDefinition {
  const def = BY_KEY.get(key);
  if (!def) {
    // A typo in a metric key must fail loudly rather than render an empty card.
    throw new Error(`Unknown metric key: ${key}. Add it to src/lib/metrics/registry.ts.`);
  }
  return def;
}

export function listMetrics(filter?: {
  platform?: 'INSTAGRAM' | 'THREADS' | null;
  scope?: MetricScope;
  label?: MetricLabel;
}): readonly MetricDefinition[] {
  if (!filter) return METRIC_DEFINITIONS;
  return RAW.filter((d) => {
    if (filter.platform !== undefined && d.platform !== filter.platform) return false;
    if (filter.scope !== undefined && d.scope !== filter.scope) return false;
    if (filter.label !== undefined && d.label !== filter.label) return false;
    return true;
  });
}

/**
 * Rows for seeding `metric_definitions` (spec section 8). The seed script consumes this so the
 * table and the code cannot disagree.
 */
export function toSeedRows(): ReadonlyArray<Record<string, unknown>> {
  return RAW.map((d) => ({
    metricKey: d.key,
    platform: d.platform,
    scope: d.scope,
    label: d.label,
    displayName: d.displayName,
    description: d.description,
    formula: d.formula,
    unit: d.unit,
    requiredInputs: [...d.requiredInputs],
    availableFrom: d.availableFrom ? new Date(`${d.availableFrom}T00:00:00Z`) : null,
    registryVersion: REGISTRY_VERSION,
  }));
}

/**
 * Structural checks run at startup and in CI. Catches the failure mode this registry exists to
 * prevent: a definition that references inputs which no longer exist after an API change.
 */
export function assertRegistryIntegrity(): void {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const def of RAW) {
    if (seen.has(def.key)) problems.push(`duplicate metric key: ${def.key}`);
    seen.add(def.key);

    for (const input of def.requiredInputs) {
      if (!BY_KEY.has(input)) {
        problems.push(`${def.key} requires unknown input ${input}`);
      }
    }
    for (const denom of def.denominatorPreference) {
      if (!BY_KEY.has(denom)) {
        problems.push(`${def.key} names unknown denominator ${denom}`);
      }
    }
    if (def.label === 'CALCULATED' && def.formula === null) {
      problems.push(`${def.key} is CALCULATED but has no formula text`);
    }
    if (def.label === 'RAW_API_METRIC' && def.formula !== null) {
      problems.push(`${def.key} is RAW_API_METRIC but declares a formula`);
    }
    if (def.description.trim().length === 0) {
      // Tooltips are a mandatory UX requirement, so a metric without one is a defect.
      problems.push(`${def.key} has no description for its tooltip`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`Metric registry integrity failed:\n - ${problems.join('\n - ')}`);
  }
}
