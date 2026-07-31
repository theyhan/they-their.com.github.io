/**
 * Metric calculators.
 *
 * Every function returns `MetricValue`, so an uncomputable result is a value the caller must
 * handle rather than a silent zero (ADR-0003 decision 4, spec 6.1).
 *
 * Numerator rule: if any summed input is absent, the result is MISSING_NUMERATOR_INPUT and names
 * the absent fields. Dropping a term instead would produce a smaller percentage that looks
 * plausible and is wrong - the specific defect ADR-0003 was written to prevent.
 */

import { getMetricDefinition, REGISTRY_VERSION } from './registry.js';
import {
  isPresent,
  notCalculable,
  ok,
  roundMetric,
  type Maybe,
  type MetricValue,
} from './types.js';

export interface InstagramMediaInputs {
  likes?: Maybe<number>;
  comments?: Maybe<number>;
  saves?: Maybe<number>;
  shares?: Maybe<number>;
  views?: Maybe<number>;
  reach?: Maybe<number>;
  nonFollowerReach?: Maybe<number>;
  followersAtPublish?: Maybe<number>;
  /** False when the connection lacks the insights permission (ADR-0002 decision 6). */
  hasInsightsScope?: boolean;
}

export interface ThreadsMediaInputs {
  likes?: Maybe<number>;
  replies?: Maybe<number>;
  reposts?: Maybe<number>;
  quotes?: Maybe<number>;
  views?: Maybe<number>;
  followersAtPublish?: Maybe<number>;
  hasInsightsScope?: boolean;
}

export interface ThreadsAccountInputs {
  clicks?: Maybe<number>;
  views?: Maybe<number>;
}

/** Public data only. Mirrors the competitor storage model: no reach, saves or shares (ADR-0001). */
export interface CompetitorMediaInputs {
  likes?: Maybe<number>;
  comments?: Maybe<number>;
  estimatedFollowersAtPublish?: Maybe<number>;
}

interface RateArgs {
  metricKey: string;
  /** Named so a missing one can be reported precisely. */
  numeratorParts: ReadonlyArray<readonly [string, Maybe<number>]>;
  /** Denominator candidates in preference order; the first present one wins. */
  denominators: ReadonlyArray<readonly [string, Maybe<number>]>;
  hasScope?: boolean;
}

/**
 * Shared rate machinery. Centralised so the precedence rule in ADR-0003 decision 3 has exactly one
 * implementation and cannot drift between metrics.
 */
function rate(args: RateArgs): MetricValue {
  const def = getMetricDefinition(args.metricKey);
  const base = { metricKey: args.metricKey, unit: def.unit, label: def.label, formulaVersion: REGISTRY_VERSION };

  if (args.hasScope === false) {
    return notCalculable({ ...base, reason: 'SCOPE_NOT_GRANTED' });
  }

  const missing = args.numeratorParts.filter(([, v]) => !isPresent(v)).map(([name]) => name);
  if (missing.length > 0) {
    return notCalculable({
      ...base,
      reason: 'MISSING_NUMERATOR_INPUT',
      detail: { missing: missing.join(', ') },
    });
  }

  const numerator = args.numeratorParts.reduce((sum, [, v]) => sum + (v as number), 0);

  const chosen = args.denominators.find(([, v]) => isPresent(v));
  if (!chosen) {
    return notCalculable({
      ...base,
      reason: 'MISSING_DENOMINATOR',
      detail: { expected: args.denominators.map(([name]) => name).join(' then ') },
    });
  }

  const [denominatorName, denominatorValue] = chosen;
  if ((denominatorValue as number) === 0) {
    return notCalculable({ ...base, reason: 'ZERO_DENOMINATOR', detail: { denominator: denominatorName } });
  }

  const isFallback = args.denominators.length > 1 && args.denominators[0]?.[0] !== denominatorName;

  return ok({
    ...base,
    value: roundMetric((numerator / (denominatorValue as number)) * 100),
    denominatorUsed: denominatorName,
    isFallbackDenominator: isFallback,
  });
}

// ---------------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------------

/** `(likes + comments + saves + shares) / reach x 100`, falling back to views. */
export function instagramEngagementRate(i: InstagramMediaInputs): MetricValue {
  return rate({
    metricKey: 'ig.media.engagement_rate',
    numeratorParts: [
      ['likes', i.likes],
      ['comments', i.comments],
      ['saves', i.saves],
      ['shares', i.shares],
    ],
    denominators: [
      ['ig.media.reach', i.reach],
      ['ig.media.views', i.views],
    ],
    hasScope: i.hasInsightsScope,
  });
}

/** Spec 6.2. Reach only - no view fallback, because the rate's meaning depends on the denominator. */
export function instagramSaveRate(i: InstagramMediaInputs): MetricValue {
  return rate({
    metricKey: 'ig.media.save_rate',
    numeratorParts: [['saves', i.saves]],
    denominators: [['ig.media.reach', i.reach]],
    hasScope: i.hasInsightsScope,
  });
}

export function instagramShareRate(i: InstagramMediaInputs): MetricValue {
  return rate({
    metricKey: 'ig.media.share_rate',
    numeratorParts: [['shares', i.shares]],
    denominators: [['ig.media.reach', i.reach]],
    hasScope: i.hasInsightsScope,
  });
}

/** Spec 6.2. Needs a follower snapshot from publication day, which pre-collection posts lack. */
export function instagramViewRate(i: InstagramMediaInputs): MetricValue {
  if (!isPresent(i.followersAtPublish)) {
    const def = getMetricDefinition('ig.media.view_rate');
    return notCalculable({
      metricKey: def.key,
      unit: def.unit,
      label: def.label,
      formulaVersion: REGISTRY_VERSION,
      reason: 'NOT_YET_COLLECTED',
      detail: { missing: 'followers at publication' },
    });
  }
  return rate({
    metricKey: 'ig.media.view_rate',
    numeratorParts: [['views', i.views]],
    denominators: [['account.followers_at_publish', i.followersAtPublish]],
    hasScope: i.hasInsightsScope,
  });
}

export function instagramNonFollowerReachShare(i: InstagramMediaInputs): MetricValue {
  return rate({
    metricKey: 'ig.media.non_follower_reach_share',
    numeratorParts: [['nonFollowerReach', i.nonFollowerReach]],
    denominators: [['ig.media.reach', i.reach]],
    hasScope: i.hasInsightsScope,
  });
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

/** `(likes + replies + reposts + quotes) / views x 100`. Views only; Threads reports no reach. */
export function threadsEngagementRate(i: ThreadsMediaInputs): MetricValue {
  return rate({
    metricKey: 'th.media.engagement_rate',
    numeratorParts: [
      ['likes', i.likes],
      ['replies', i.replies],
      ['reposts', i.reposts],
      ['quotes', i.quotes],
    ],
    denominators: [['th.media.views', i.views]],
    hasScope: i.hasInsightsScope,
  });
}

export function threadsReplyRate(i: ThreadsMediaInputs): MetricValue {
  return rate({
    metricKey: 'th.media.reply_rate',
    numeratorParts: [['replies', i.replies]],
    denominators: [['th.media.views', i.views]],
    hasScope: i.hasInsightsScope,
  });
}

export function threadsRepostRate(i: ThreadsMediaInputs): MetricValue {
  return rate({
    metricKey: 'th.media.repost_rate',
    numeratorParts: [['reposts', i.reposts]],
    denominators: [['th.media.views', i.views]],
    hasScope: i.hasInsightsScope,
  });
}

export function threadsQuoteRate(i: ThreadsMediaInputs): MetricValue {
  return rate({
    metricKey: 'th.media.quote_rate',
    numeratorParts: [['quotes', i.quotes]],
    denominators: [['th.media.views', i.views]],
    hasScope: i.hasInsightsScope,
  });
}

/** Spec 6.3. Interactions that spread the thread rather than only acknowledging it. */
export function threadsConversationSpreadRate(i: ThreadsMediaInputs): MetricValue {
  return rate({
    metricKey: 'th.media.conversation_spread_rate',
    numeratorParts: [
      ['replies', i.replies],
      ['reposts', i.reposts],
      ['quotes', i.quotes],
    ],
    denominators: [['th.media.views', i.views]],
    hasScope: i.hasInsightsScope,
  });
}

/** Account scope. This is the only scope at which Threads publishes clicks. */
export function threadsAccountClickThroughRate(i: ThreadsAccountInputs): MetricValue {
  return rate({
    metricKey: 'th.account.click_through_rate',
    numeratorParts: [['clicks', i.clicks]],
    denominators: [['th.account.views', i.views]],
  });
}

/**
 * ADR-0003 decision 5. Spec 6.3 defined a per-post click-through rate; Threads exposes no per-post
 * click numerator, so this always reports the scope mismatch. Kept as a named function so callers
 * that expect the spec's version get a clear answer instead of a missing export.
 *
 * If a live app proves per-post clicks exist, change the registry scope and implement this.
 */
export function threadsPostClickThroughRate(): MetricValue {
  const def = getMetricDefinition('th.account.click_through_rate');
  return notCalculable({
    metricKey: def.key,
    unit: def.unit,
    label: def.label,
    formulaVersion: REGISTRY_VERSION,
    reason: 'METRIC_NOT_AVAILABLE_AT_SCOPE',
    detail: { availableScope: 'ACCOUNT' },
  });
}

// ---------------------------------------------------------------------------
// Cross-platform
// ---------------------------------------------------------------------------

/** Spec 6.1. Zero starting followers yields ZERO_DENOMINATOR, not infinite growth. */
export function followerGrowthRate(startingFollowers: Maybe<number>, endingFollowers: Maybe<number>): MetricValue {
  const def = getMetricDefinition('account.follower_growth_rate');
  const base = { metricKey: def.key, unit: def.unit, label: def.label, formulaVersion: REGISTRY_VERSION };

  if (!isPresent(startingFollowers) || !isPresent(endingFollowers)) {
    return notCalculable({ ...base, reason: 'NOT_YET_COLLECTED', detail: { missing: 'follower snapshot' } });
  }
  if (startingFollowers === 0) {
    return notCalculable({ ...base, reason: 'ZERO_DENOMINATOR' });
  }
  return ok({
    ...base,
    value: roundMetric(((endingFollowers - startingFollowers) / startingFollowers) * 100),
    denominatorUsed: 'starting followers',
  });
}

/** Spec 6.1. Days per post across the period; zero posts is not an interval of zero. */
export function publishingIntervalDays(daysInPeriod: number, postCount: number): MetricValue {
  const def = getMetricDefinition('account.publishing_interval_days');
  const base = { metricKey: def.key, unit: def.unit, label: def.label, formulaVersion: REGISTRY_VERSION };

  if (postCount === 0) {
    return notCalculable({ ...base, reason: 'ZERO_DENOMINATOR', detail: { postCount } });
  }
  return ok({ ...base, value: roundMetric(daysInPeriod / postCount), denominatorUsed: 'account.post_count' });
}

/**
 * Spec 6.1, used for competitor comparison where public interactions are the only signal.
 * Labelled ESTIMATE by its definition, because the denominator is interpolated between snapshots
 * taken after monitoring began (ADR-0001 decision 5).
 */
export function followerInteractionRate(i: CompetitorMediaInputs): MetricValue {
  return rate({
    metricKey: 'account.follower_interaction_rate',
    numeratorParts: [
      ['likes', i.likes],
      ['comments', i.comments],
    ],
    denominators: [['account.followers_at_publish', i.estimatedFollowersAtPublish]],
  });
}

/**
 * Guard for spec 3.2. Any attempt to compute an owner-only metric from competitor data returns
 * COMPETITOR_SCOPE_FORBIDDEN. The types already make the inputs unavailable; this exists so a
 * shared UI component asking for the metric receives an explainable answer.
 */
export function competitorOwnerOnlyMetric(metricKey: string): MetricValue {
  const def = getMetricDefinition(metricKey);
  return notCalculable({
    metricKey: def.key,
    unit: def.unit,
    label: def.label,
    formulaVersion: REGISTRY_VERSION,
    reason: 'COMPETITOR_SCOPE_FORBIDDEN',
  });
}
