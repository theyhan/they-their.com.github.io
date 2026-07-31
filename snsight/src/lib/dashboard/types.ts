/**
 * Dashboard view model (spec SCR-002, FR-003, FR-009).
 *
 * The mandatory UX rules in spec section 7 are properties of this model rather than of the React
 * tree: every metric carries its label and tooltip, every change carries a shape and a sentence so
 * it is not communicated by colour alone, every empty state carries a reason and an action, and
 * every figure carries the drill-down reference that resolves it to content.
 *
 * Keeping these in a plain data structure means they can be verified by execution. A rule that only
 * exists inside a component is a rule nobody checks.
 */

import type { MetricLabel, MetricValue, NotCalculableReason } from '../metrics/index.js';
import type { MediaType, Platform } from '../platform/types.js';

/**
 * ADR-0003 consequences: a metric reaches the screen in one of four states, and all four need a
 * design. Only the first is usually mocked, which is why they are enumerated here.
 */
export type MetricDisplayState =
  /** A number computed on its preferred inputs. */
  | 'VALUE'
  /** A number computed on a fallback denominator, which must be disclosed alongside it. */
  | 'VALUE_WITH_CAVEAT'
  /** Knowable in principle, not knowable here. Carries reason and corrective action. */
  | 'NOT_CALCULABLE'
  /** Outside the account's collected coverage window. Distinct from "zero" and from "broken". */
  | 'NOT_SYNCED';

export interface MetricDisplay {
  readonly metricKey: string;
  readonly displayName: string;
  readonly state: MetricDisplayState;
  /** Spec 3.3. Rendered as a visible badge, not a tooltip-only detail. */
  readonly label: MetricLabel;
  readonly labelText: string;
  /** Mandatory definition tooltip, generated from the registry so it cannot be omitted. */
  readonly tooltip: string;
  /** Formatted for display, e.g. "13.5%" or "12,480". Absent when there is no value. */
  readonly valueText?: string;
  readonly rawValue?: number;
  /** Present in VALUE_WITH_CAVEAT: what was substituted and why it matters. */
  readonly caveat?: string;
  /** Present in NOT_CALCULABLE and NOT_SYNCED. */
  readonly reason?: NotCalculableReason;
  readonly reasonText?: string;
  readonly actionText?: string;
}

export type ChangeDirection = 'UP' | 'DOWN' | 'FLAT' | 'UNKNOWN';

/**
 * "Do not communicate positive or negative change through color alone."
 *
 * `glyph` and `text` carry the meaning; colour is decoration applied from `polarity`. Direction and
 * polarity are separate fields on purpose: a falling publishing interval is an improvement, so
 * inferring good-or-bad from the arrow would mislabel several metrics.
 */
export interface ChangeIndicator {
  readonly direction: ChangeDirection;
  readonly glyph: string;
  readonly text: string;
  /** Full sentence for screen readers, since a glyph alone is not announced meaningfully. */
  readonly srText: string;
  readonly polarity: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  readonly deltaPercent?: number;
}

export type ContentSort = 'NEWEST' | 'VIEWS' | 'INTERACTIONS' | 'ENGAGEMENT_RATE' | 'PERFORMANCE_INDEX';

/** FR-009: every KPI card and chart point resolves to the content behind it. */
export interface DrilldownRef {
  readonly metricKey: string;
  readonly platform: Platform | null;
  readonly mediaType?: MediaType;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly sort: ContentSort;
}

export interface KpiCard {
  readonly id: string;
  readonly title: string;
  readonly platform: Platform | null;
  readonly metric: MetricDisplay;
  /**
   * Null where a period-over-period comparison is meaningless rather than merely unavailable - a
   * growth rate already expresses change, so pairing it with "no comparison available" would be
   * noise dressed as information.
   */
  readonly change: ChangeIndicator | null;
  /** Null only where no content can explain the figure, such as a follower count. */
  readonly drilldown: DrilldownRef | null;
  readonly footnote?: string;
}

export type TrendPointState = 'VALUE' | 'NO_ACTIVITY' | 'OUTSIDE_COVERAGE';

/**
 * A trend point distinguishes "nothing was published" from "we have no data for this date". Both
 * would render as zero if collapsed, inventing a decline that did not happen.
 */
export interface TrendPoint {
  readonly date: string;
  readonly value: number | null;
  readonly state: TrendPointState;
  readonly postCount: number;
}

export interface TrendSeries {
  readonly metricKey: string;
  readonly displayName: string;
  readonly platform: Platform;
  readonly label: MetricLabel;
  readonly tooltip: string;
  readonly points: readonly TrendPoint[];
  /** Dates inside the period but outside coverage, surfaced as a caption rather than a silent gap. */
  readonly uncoveredDates: readonly string[];
}

export interface ContentRow {
  readonly mediaPostId: string;
  readonly platform: Platform;
  readonly mediaType: MediaType;
  readonly publishedAt: string;
  readonly excerpt: string;
  readonly permalink: string | null;
  readonly thumbnailUrl: string | null;
  readonly childMediaUrls: readonly string[];
  /** Native metrics, shown per platform and never pooled across platforms (spec 6.4). */
  readonly nativeMetrics: readonly MetricDisplay[];
  readonly engagementRate: MetricDisplay;
  readonly performanceIndex: MetricDisplay;
}

/**
 * FR-003 asks for contribution by platform. Pooling views or reach across platforms to produce a
 * share would breach spec 6.4, so contribution is expressed on post count - where a post is
 * genuinely a post on both platforms - and each platform's own interaction total is shown beside
 * it rather than merged into one denominator.
 */
export interface PlatformContribution {
  readonly platform: Platform;
  readonly postCount: number;
  readonly postSharePercent: number;
  readonly nativeInteractions: MetricDisplay;
  readonly nativeInteractionsNote: string;
}

export interface PlatformSection {
  readonly platform: Platform;
  readonly connectionStatusText: string;
  readonly kpis: readonly KpiCard[];
  readonly trend: TrendSeries;
  readonly contribution: PlatformContribution;
  readonly coverageNotice?: string;
}

export type AiSummaryState = 'READY' | 'PENDING' | 'UNAVAILABLE';

/**
 * ADR-0006 decision 1: no model call happens in a dashboard request, so PENDING is a normal state
 * rather than an error. Confidence is computed from the evidence base before any model runs, which
 * is why it is present even while the narrative is not.
 */
export interface AiSummaryPanel {
  readonly state: AiSummaryState;
  readonly text?: string;
  readonly confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  readonly confidenceRationale: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly postsAnalyzed: number;
  /** Spec 3.3: supporting posts are part of the claim, not an optional extra. */
  readonly evidence: readonly ContentRow[];
  readonly stateExplanation: string;
  /** Distinct from the sync time, or a stale narrative reads as current. */
  readonly generatedAt?: string;
}

export interface SyncStatusRow {
  readonly platform: Platform;
  readonly username: string;
  readonly lastSuccessfulSyncAt: string | null;
  readonly statusText: string;
  readonly isHealthy: boolean;
}

export interface DashboardPeriod {
  readonly start: string;
  readonly end: string;
  readonly label: string;
  readonly days: number;
}

export interface DashboardViewModel {
  readonly generatedAt: string;
  /** ADR-0007 decision 5: fixture-backed workspaces are marked wherever their numbers appear. */
  readonly isDemo: boolean;
  readonly period: DashboardPeriod;
  readonly comparison: DashboardPeriod;
  readonly syncStatus: readonly SyncStatusRow[];
  /** Coverage limits stated plainly, e.g. the Threads epoch, rather than shown as flat lines. */
  readonly coverageNotices: readonly string[];
  readonly commonKpis: readonly KpiCard[];
  readonly platformSections: readonly PlatformSection[];
  readonly bestContent: readonly ContentRow[];
  readonly worstContent: readonly ContentRow[];
  readonly rankingNote: string;
  readonly aiSummary: AiSummaryPanel;
  readonly nextActions: readonly NextAction[];
}

export interface NextAction {
  readonly id: string;
  readonly title: string;
  readonly rationale: string;
  /** Recommendations are hypotheses until a run supports them (ADR-0006 decision 6). */
  readonly isHypothesis: boolean;
  readonly evidenceCount: number;
}

/** Input to the builder. Deliberately plain, so it can come from the database or a provider. */
export interface DashboardInput {
  readonly isDemo: boolean;
  readonly period: DashboardPeriod;
  readonly comparison: DashboardPeriod;
  readonly accounts: readonly DashboardAccountInput[];
  readonly generatedAt: string;
}

export interface DashboardAccountInput {
  readonly platform: Platform;
  readonly username: string;
  readonly lastSuccessfulSyncAt: string | null;
  readonly connectionStatus: 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' | 'REVOKED' | 'INSUFFICIENT_SCOPE' | 'RATE_LIMITED';
  readonly dataCoverageStartsAt: string | null;
  readonly followersAtPeriodStart: number | null;
  readonly followersAtPeriodEnd: number | null;
  readonly followersAtComparisonStart: number | null;
  readonly posts: readonly DashboardPostInput[];
  readonly comparisonPosts: readonly DashboardPostInput[];
  /**
   * Posts in the trailing cohort window (90 days by ADR-0004), used only to rank the performance
   * index. Deliberately independent of the selected period: scoring a post against the 7 days the
   * user happens to be viewing would make its index move with the date picker, and would leave most
   * cohorts under the 8-post minimum. Includes the period's posts.
   */
  readonly cohortPosts: readonly DashboardPostInput[];
}

export interface DashboardPostInput {
  readonly mediaPostId: string;
  readonly mediaType: MediaType;
  readonly publishedAt: string;
  readonly caption: string | null;
  readonly permalink: string | null;
  readonly thumbnailUrl: string | null;
  readonly childMediaUrls: readonly string[];
  readonly likes: number | null;
  readonly comments: number | null;
  readonly saves: number | null;
  readonly shares: number | null;
  readonly views: number | null;
  readonly reach: number | null;
  readonly replies: number | null;
  readonly reposts: number | null;
  readonly quotes: number | null;
  readonly engagementRate: MetricValue;
}
