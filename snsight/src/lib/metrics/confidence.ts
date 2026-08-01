/**
 * Confidence rating for AI analysis (spec FR-011, rubric fixed by ADR-0006 decision 3).
 *
 * Computed from the evidence base before the model is called, and passed to the renderer. A model
 * asked to rate its own confidence will report high confidence on three posts, which is exactly
 * the overconfidence that spec section 15 names as a key risk.
 */

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ConfidenceInputs {
  /** Posts inside the analysis window that carried usable metrics. */
  postsAnalyzed: number;
  /** Days of the window actually covered by collected data, not the requested length. */
  daysCovered: number;
  /** Share of required metrics that resolved to a value rather than NotCalculable, 0-1. */
  metricCoverage: number;
  /** True for public-data competitor analysis, which rests on estimates (ADR-0001). */
  isCompetitorScope: boolean;
}

export interface ConfidenceAssessment {
  readonly level: ConfidenceLevel;
  /** Shown next to the narrative so the rating is inspectable rather than asserted. */
  readonly rationale: string;
  readonly inputs: ConfidenceInputs;
}

export const CONFIDENCE_THRESHOLDS = {
  HIGH: { posts: 20, days: 28, coverage: 0.9 },
  MEDIUM: { posts: 8, days: 14, coverage: 0.7 },
} as const;

export function assessConfidence(inputs: ConfidenceInputs): ConfidenceAssessment {
  const { postsAnalyzed, daysCovered, metricCoverage, isCompetitorScope } = inputs;

  // Competitor analysis is capped at LOW regardless of volume: more public posts do not make an
  // estimated follower denominator into a measured one.
  if (isCompetitorScope) {
    return {
      level: 'LOW',
      rationale:
        'Based on publicly available data only. Owner metrics such as reach and saves are not available for this account, and follower counts at posting time are estimated.',
      inputs,
    };
  }

  const high = CONFIDENCE_THRESHOLDS.HIGH;
  if (postsAnalyzed >= high.posts && daysCovered >= high.days && metricCoverage >= high.coverage) {
    return {
      level: 'HIGH',
      rationale: `${postsAnalyzed} posts across ${daysCovered} days, with ${formatPercent(metricCoverage)} of required metrics available.`,
      inputs,
    };
  }

  const medium = CONFIDENCE_THRESHOLDS.MEDIUM;
  if (postsAnalyzed >= medium.posts && daysCovered >= medium.days && metricCoverage >= medium.coverage) {
    return {
      level: 'MEDIUM',
      rationale: `${postsAnalyzed} posts across ${daysCovered} days, with ${formatPercent(metricCoverage)} of required metrics available. Treat directional conclusions as hypotheses.`,
      inputs,
    };
  }

  return {
    level: 'LOW',
    rationale: `${describeShortfall(inputs)} Conclusions are provisional and may change as data accumulates.`,
    inputs,
  };
}

function describeShortfall(inputs: ConfidenceInputs): string {
  const parts: string[] = [];
  const medium = CONFIDENCE_THRESHOLDS.MEDIUM;
  if (inputs.postsAnalyzed < medium.posts) {
    parts.push(`only ${inputs.postsAnalyzed} post(s) analysed (${medium.posts} needed for medium confidence)`);
  }
  if (inputs.daysCovered < medium.days) {
    parts.push(`only ${inputs.daysCovered} day(s) of data covered (${medium.days} needed)`);
  }
  if (inputs.metricCoverage < medium.coverage) {
    parts.push(`${formatPercent(inputs.metricCoverage)} of required metrics available (${formatPercent(medium.coverage)} needed)`);
  }
  return parts.length > 0 ? `Limited evidence: ${parts.join('; ')}.` : 'Limited evidence.';
}

function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/**
 * Metric coverage from actual results, so the rubric input is measured rather than asserted.
 * Kept generic over anything carrying a `kind`, to avoid a circular import with `types.ts`.
 */
export function computeMetricCoverage(values: readonly { kind: 'value' | 'not_calculable' }[]): number {
  if (values.length === 0) return 0;
  const calculable = values.filter((v) => v.kind === 'value').length;
  return calculable / values.length;
}
