/**
 * Metric value types.
 *
 * ADR-0003 decision 4: a metric that cannot be computed is a distinct variant, not `null` and
 * never `0`. Spec 6.1 requires "Not Calculable" to reach the screen, and the only reliable way
 * to guarantee that is to make the compiler reject call sites that ignore it.
 */

/** Spec 3.3. Every value surfaced in the UI carries one of these. */
export type MetricLabel = 'RAW_API_METRIC' | 'CALCULATED' | 'ESTIMATE' | 'AI_INTERPRETATION';

export type MetricScope = 'ACCOUNT' | 'MEDIA' | 'AUDIENCE';

export type MetricUnit = 'COUNT' | 'PERCENT' | 'DAYS' | 'INDEX' | 'RATIO';

export type NotCalculableReason =
  | 'MISSING_DENOMINATOR'
  | 'ZERO_DENOMINATOR'
  | 'MISSING_NUMERATOR_INPUT'
  | 'METRIC_NOT_AVAILABLE_IN_API_VERSION'
  | 'METRIC_NOT_AVAILABLE_AT_SCOPE'
  | 'SCOPE_NOT_GRANTED'
  | 'COMPETITOR_SCOPE_FORBIDDEN'
  | 'INSUFFICIENT_SAMPLE'
  | 'NOT_YET_COLLECTED';

/**
 * Copy for the mandatory empty state ("Empty states must explain the reason and provide a
 * corrective action"). Held next to the reason codes so a new reason cannot be added without
 * its explanation.
 */
export const NOT_CALCULABLE_COPY: Record<NotCalculableReason, { reason: string; action: string }> = {
  MISSING_DENOMINATOR: {
    reason: 'The denominator this rate needs was not returned for this post.',
    action: 'Check that insights permissions are granted, then resync the account.',
  },
  ZERO_DENOMINATOR: {
    reason: 'The denominator is zero, so a rate would be undefined.',
    action: 'Wait for the post to accumulate views, or widen the date range.',
  },
  MISSING_NUMERATOR_INPUT: {
    reason: 'One or more interaction counts this metric sums were unavailable.',
    action: 'Reconnect the account to restore the missing insight fields.',
  },
  METRIC_NOT_AVAILABLE_IN_API_VERSION: {
    reason: 'The platform no longer returns this metric on the API version in use.',
    action: 'See the metric definition for the period in which it was available.',
  },
  METRIC_NOT_AVAILABLE_AT_SCOPE: {
    reason: 'The platform publishes this metric for the account, not for individual posts.',
    action: 'View it on the account overview instead.',
  },
  SCOPE_NOT_GRANTED: {
    reason: 'This account has not granted the permission required to read this metric.',
    action: 'Reconnect the account and approve the insights permission.',
  },
  COMPETITOR_SCOPE_FORBIDDEN: {
    reason: 'This metric is available only to an account owner, so it cannot be shown for a competitor.',
    action: 'Connect the account directly if you own it.',
  },
  INSUFFICIENT_SAMPLE: {
    reason: 'There is not enough comparable content yet to score this reliably.',
    action: 'Keep publishing, or widen the comparison window.',
  },
  NOT_YET_COLLECTED: {
    reason: 'This period predates the start of data collection for this account.',
    action: 'Choose a range inside the available coverage window.',
  },
};

/** A computed value, with the provenance needed to audit it. */
export interface MetricOk {
  readonly kind: 'value';
  readonly metricKey: string;
  readonly value: number;
  readonly unit: MetricUnit;
  readonly label: MetricLabel;
  /**
   * ADR-0003 decision 3. Which input served as the denominator, and whether it was the preferred
   * one. Values computed on a fallback denominator must not be compared against preferred ones,
   * so the fact travels with the number instead of being inferred later.
   */
  readonly denominatorUsed?: string;
  readonly isFallbackDenominator: boolean;
  readonly formulaVersion: string;
}

export interface MetricUnavailable {
  readonly kind: 'not_calculable';
  readonly metricKey: string;
  readonly reason: NotCalculableReason;
  readonly unit: MetricUnit;
  readonly label: MetricLabel;
  /** Numbers the empty state can quote, e.g. { present: 3, required: 8 }. */
  readonly detail?: Readonly<Record<string, number | string>>;
  readonly formulaVersion: string;
}

export type MetricValue = MetricOk | MetricUnavailable;

export function isCalculable(value: MetricValue): value is MetricOk {
  return value.kind === 'value';
}

export interface OkArgs {
  metricKey: string;
  value: number;
  unit: MetricUnit;
  label: MetricLabel;
  formulaVersion: string;
  denominatorUsed?: string;
  isFallbackDenominator?: boolean;
}

export function ok(args: OkArgs): MetricOk {
  return {
    kind: 'value',
    metricKey: args.metricKey,
    value: args.value,
    unit: args.unit,
    label: args.label,
    denominatorUsed: args.denominatorUsed,
    isFallbackDenominator: args.isFallbackDenominator ?? false,
    formulaVersion: args.formulaVersion,
  };
}

export interface UnavailableArgs {
  metricKey: string;
  reason: NotCalculableReason;
  unit: MetricUnit;
  label: MetricLabel;
  formulaVersion: string;
  detail?: Readonly<Record<string, number | string>>;
}

export function notCalculable(args: UnavailableArgs): MetricUnavailable {
  return {
    kind: 'not_calculable',
    metricKey: args.metricKey,
    reason: args.reason,
    unit: args.unit,
    label: args.label,
    detail: args.detail,
    formulaVersion: args.formulaVersion,
  };
}

/**
 * Numeric inputs arrive from adapters as `number | null | undefined`, because a platform omitting
 * a field and returning zero for it are different facts. This narrows without conflating them.
 */
export type Maybe<T> = T | null | undefined;

export function isPresent(value: Maybe<number>): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Rounds to 4 decimals so equal inputs cannot yield different stored values. */
export function roundMetric(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
