/**
 * Presentation of metric values (spec section 7 mandatory UX requirements).
 *
 * Every `MetricValue` becomes a `MetricDisplay` here, and this is the only place that decides what a
 * user sees for each of the four states. Formatting a metric anywhere else would let a
 * NotCalculable slip through as an em dash with no explanation, which is the failure spec 6.1 and
 * the empty-state rule both prohibit.
 */

import {
  getMetricDefinition,
  isCalculable,
  NOT_CALCULABLE_COPY,
  type MetricLabel,
  type MetricValue,
  type MetricUnit,
} from '../metrics/index.js';
import type { ChangeIndicator, MetricDisplay, MetricDisplayState } from './types.js';

const NUMBER = new Intl.NumberFormat('en-US');
const DECIMAL = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Spec 3.3 badge text. Estimates and AI interpretations must not read as verified facts. */
export const LABEL_TEXT: Record<MetricLabel, string> = {
  RAW_API_METRIC: 'From platform',
  CALCULATED: 'Calculated',
  ESTIMATE: 'Estimate',
  AI_INTERPRETATION: 'AI interpretation',
};

/**
 * Whether a rise is an improvement. Separate from direction because several metrics invert: a
 * shorter publishing interval is better, and inferring polarity from the arrow would mislabel them.
 */
type Polarity = 'HIGHER_BETTER' | 'LOWER_BETTER' | 'NEUTRAL';

const POLARITY: Record<string, Polarity> = {
  'account.publishing_interval_days': 'LOWER_BETTER',
  'account.followers_count': 'HIGHER_BETTER',
  'account.follower_growth_rate': 'HIGHER_BETTER',
  // Non-follower reach share is genuinely ambiguous: high can mean strong distribution or weak
  // resonance with existing followers, so it is presented without a verdict.
  'ig.media.non_follower_reach_share': 'NEUTRAL',
};

export function polarityOf(metricKey: string): Polarity {
  return POLARITY[metricKey] ?? 'HIGHER_BETTER';
}

export function formatUnit(value: number, unit: MetricUnit): string {
  switch (unit) {
    case 'PERCENT':
      return `${DECIMAL.format(value)}%`;
    case 'DAYS':
      return value === 1 ? '1 day' : `${DECIMAL.format(value)} days`;
    case 'INDEX':
      return `${Math.round(value)} / 100`;
    case 'RATIO':
      return DECIMAL.format(value);
    case 'COUNT':
    default:
      return NUMBER.format(Math.round(value));
  }
}

/** The mandatory definition tooltip, assembled from the registry so a metric cannot ship without one. */
export function buildTooltip(metricKey: string, extra?: string): string {
  const def = getMetricDefinition(metricKey);
  const parts = [def.description];
  if (def.formula) parts.push(`Formula: ${def.formula}.`);
  if (def.availableFrom) parts.push(`Platform data available from ${def.availableFrom}.`);
  if (extra) parts.push(extra);
  return parts.join(' ');
}

export interface DisplayOptions {
  /** True when the requested period precedes the account's coverage; renders NOT_SYNCED. */
  isOutsideCoverage?: boolean;
  /** Overrides the registry display name, e.g. "Views" shown as "Reels views". */
  displayName?: string;
  tooltipExtra?: string;
}

export function toMetricDisplay(value: MetricValue, options: DisplayOptions = {}): MetricDisplay {
  const def = getMetricDefinition(value.metricKey);
  const displayName = options.displayName ?? def.displayName;
  const tooltip = buildTooltip(value.metricKey, options.tooltipExtra);

  const shared = {
    metricKey: value.metricKey,
    displayName,
    label: value.label,
    labelText: LABEL_TEXT[value.label],
    tooltip,
  };

  if (options.isOutsideCoverage) {
    const copy = NOT_CALCULABLE_COPY.NOT_YET_COLLECTED;
    return {
      ...shared,
      state: 'NOT_SYNCED',
      reason: 'NOT_YET_COLLECTED',
      reasonText: copy.reason,
      actionText: copy.action,
    };
  }

  if (!isCalculable(value)) {
    const copy = NOT_CALCULABLE_COPY[value.reason];
    // Reason detail is appended to the sentence so the empty state quotes real numbers, e.g. how
    // many posts are present versus required.
    const detail = value.detail
      ? Object.entries(value.detail)
          .map(([key, detailValue]) => `${humanise(key)}: ${detailValue}`)
          .join(', ')
      : undefined;
    return {
      ...shared,
      state: value.reason === 'NOT_YET_COLLECTED' ? 'NOT_SYNCED' : 'NOT_CALCULABLE',
      reason: value.reason,
      reasonText: detail ? `${copy.reason} (${detail})` : copy.reason,
      actionText: copy.action,
    };
  }

  const state: MetricDisplayState = value.isFallbackDenominator ? 'VALUE_WITH_CAVEAT' : 'VALUE';
  const caveat = value.isFallbackDenominator
    ? `Calculated on ${describeDenominator(value.denominatorUsed)} because the preferred denominator was unavailable. Not directly comparable with values based on ${describeDenominator(getMetricDefinition(value.metricKey).denominatorPreference[0])}.`
    : undefined;

  return {
    ...shared,
    state,
    valueText: formatUnit(value.value, value.unit),
    rawValue: value.value,
    caveat,
  };
}

/** Raw platform counts that arrive outside the metric pipeline, e.g. a follower total. */
export function rawCountDisplay(
  metricKey: string,
  value: number | null,
  options: DisplayOptions = {},
): MetricDisplay {
  const def = getMetricDefinition(metricKey);
  const shared = {
    metricKey,
    displayName: options.displayName ?? def.displayName,
    label: def.label,
    labelText: LABEL_TEXT[def.label],
    tooltip: buildTooltip(metricKey, options.tooltipExtra),
  };

  if (value === null || options.isOutsideCoverage) {
    const copy = NOT_CALCULABLE_COPY.NOT_YET_COLLECTED;
    return { ...shared, state: 'NOT_SYNCED', reason: 'NOT_YET_COLLECTED', reasonText: copy.reason, actionText: copy.action };
  }
  return { ...shared, state: 'VALUE', valueText: formatUnit(value, def.unit), rawValue: value };
}

function describeDenominator(key: string | undefined): string {
  if (!key) return 'an alternative denominator';
  if (key.endsWith('.views')) return 'views';
  if (key.endsWith('.reach')) return 'reach';
  if (key.includes('followers')) return 'followers at publication';
  return key;
}

function humanise(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

export interface ChangeOptions {
  metricKey: string;
  current: number | null;
  previous: number | null;
  comparisonLabel: string;
  /** Below this absolute percentage the change reads as flat rather than as noise. */
  flatThresholdPercent?: number;
}

/**
 * Builds a change indicator whose meaning survives without colour: a shape, a signed number, and a
 * sentence naming the comparison period.
 */
export function buildChangeIndicator(options: ChangeOptions): ChangeIndicator {
  const { current, previous, comparisonLabel, metricKey } = options;
  const flatThreshold = options.flatThresholdPercent ?? 0.5;

  if (current === null || previous === null) {
    return {
      direction: 'UNKNOWN',
      glyph: '–',
      text: `No comparison available for ${comparisonLabel}`,
      srText: `No comparison is available for ${comparisonLabel}, so change cannot be shown.`,
      polarity: 'NEUTRAL',
    };
  }

  if (previous === 0) {
    // A percentage change from zero is undefined, so the absolute movement is reported instead of
    // an infinite or fabricated figure.
    const movedUp = current > 0;
    return {
      direction: movedUp ? 'UP' : 'FLAT',
      glyph: movedUp ? '\u25B2' : '\u25A0',
      text: movedUp ? `New activity vs ${comparisonLabel} (was zero)` : `No change vs ${comparisonLabel}`,
      srText: movedUp
        ? `Increased from zero in ${comparisonLabel}; a percentage change cannot be calculated from zero.`
        : `Unchanged at zero compared with ${comparisonLabel}.`,
      polarity: movedUp ? polarityToSentiment(metricKey, 'UP') : 'NEUTRAL',
    };
  }

  const deltaPercent = ((current - previous) / Math.abs(previous)) * 100;
  const rounded = Math.round(deltaPercent * 10) / 10;

  if (Math.abs(rounded) < flatThreshold) {
    return {
      direction: 'FLAT',
      glyph: '\u25A0',
      text: `Flat vs ${comparisonLabel}`,
      srText: `Effectively unchanged compared with ${comparisonLabel}.`,
      polarity: 'NEUTRAL',
      deltaPercent: rounded,
    };
  }

  const direction = rounded > 0 ? 'UP' : 'DOWN';
  const sign = rounded > 0 ? '+' : '';
  const verb = rounded > 0 ? 'Increased' : 'Decreased';

  return {
    direction,
    glyph: rounded > 0 ? '\u25B2' : '\u25BC',
    text: `${sign}${DECIMAL.format(rounded)}% vs ${comparisonLabel}`,
    srText: `${verb} ${DECIMAL.format(Math.abs(rounded))} percent compared with ${comparisonLabel}.`,
    polarity: polarityToSentiment(metricKey, direction),
    deltaPercent: rounded,
  };
}

function polarityToSentiment(metricKey: string, direction: 'UP' | 'DOWN'): 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' {
  const polarity = polarityOf(metricKey);
  if (polarity === 'NEUTRAL') return 'NEUTRAL';
  const better = polarity === 'HIGHER_BETTER' ? 'UP' : 'DOWN';
  return direction === better ? 'POSITIVE' : 'NEGATIVE';
}

export function excerpt(caption: string | null, maxLength = 110): string {
  if (!caption) return 'No caption';
  const trimmed = caption.trim();
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength - 1)}\u2026`;
}
