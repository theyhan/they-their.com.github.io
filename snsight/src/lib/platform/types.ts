/**
 * Platform provider contract (ADR-0007 decision 1).
 *
 * Callers see normalized domain models only. Provider-specific field names, pagination shapes and
 * error payloads stop at the adapter boundary, which is what lets an API rename be absorbed in one
 * file (spec section 15 mitigation) and what lets the fixture backend be substituted wholesale.
 */

export type Platform = 'INSTAGRAM' | 'THREADS';

export type MediaType =
  | 'IG_IMAGE'
  | 'IG_CAROUSEL'
  | 'IG_REEL'
  | 'IG_STORY'
  | 'IG_VIDEO'
  | 'TH_TEXT'
  | 'TH_IMAGE'
  | 'TH_VIDEO'
  | 'TH_CAROUSEL'
  | 'TH_REPOST';

export type ThreadPostKind = 'ORIGINAL' | 'REPLY' | 'QUOTE' | 'REPOST';

/** ISO date, `YYYY-MM-DD`. Used where a metric is daily rather than instantaneous. */
export type IsoDate = string;

export interface NormalizedAccount {
  platform: Platform;
  platformUserId: string;
  username: string;
  displayName: string | null;
  biography: string | null;
  profileImageUrl: string | null;
  isProfessional: boolean;
  followersCount: number | null;
  followsCount: number | null;
  mediaCount: number | null;
  /**
   * Earliest date this provider can supply data for. Threads cannot precede 2024-04-13, and a
   * fresh Instagram connection is limited by the platform's own retention, so partial coverage is
   * reported rather than inferred from the first row returned.
   */
  dataCoverageStartsAt: IsoDate | null;
}

export interface NormalizedAccountSnapshot {
  capturedOn: IsoDate;
  followersCount: number | null;
  followsCount: number | null;
  mediaCount: number | null;
  /** Threads publishes account-scope clicks; Instagram has no equivalent (ADR-0003 decision 5). */
  accountClicks: number | null;
}

/**
 * First-party post. Every metric is nullable because "the platform did not return this" and "the
 * value is zero" are different facts, and collapsing them is what produces the fabricated zeroes
 * spec 6.1 forbids.
 */
export interface NormalizedMediaPost {
  platform: Platform;
  platformMediaId: string;
  mediaType: MediaType;
  threadKind: ThreadPostKind | null;
  parentPlatformMediaId: string | null;
  conversationDepth: number | null;
  caption: string | null;
  permalink: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  childMediaUrls: string[];
  publishedAt: string;
  metrics: NormalizedMediaMetrics;
}

export interface NormalizedMediaMetrics {
  likes: number | null;
  comments: number | null;
  /** Instagram owner-only. */
  saves: number | null;
  shares: number | null;
  views: number | null;
  reach: number | null;
  nonFollowerReach: number | null;
  /** Threads. */
  replies: number | null;
  reposts: number | null;
  quotes: number | null;
}

export interface NormalizedDailyInsight {
  capturedOn: IsoDate;
  metricKey: string;
  value: number | null;
}

export interface NormalizedAudienceInsight {
  capturedOn: IsoDate;
  metricKey: string;
  dimension: string;
  dimensionValue: string;
  value: number | null;
}

// ---------------------------------------------------------------------------
// Competitor models (spec 3.2, ADR-0001)
//
// These types are the enforcement point. `CompetitorMediaMetrics` declares two fields and no
// optional owner-only ones, so a contributor cannot populate reach or saves for a competitor even
// by mistake - there is nowhere to put the value.
// ---------------------------------------------------------------------------

export interface CompetitorMediaMetrics {
  likes: number | null;
  comments: number | null;
}

export interface CompetitorProfile {
  platform: Platform;
  platformUserId: string | null;
  username: string;
  displayName: string | null;
  biography: string | null;
  profileImageUrl: string | null;
  followersCount: number | null;
  followsCount: number | null;
  mediaCount: number | null;
}

export interface CompetitorMedia {
  platformMediaId: string;
  mediaType: MediaType;
  caption: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  publishedAt: string;
  metrics: CompetitorMediaMetrics;
}

export type CompetitorEligibility =
  | 'ELIGIBLE'
  | 'TARGET_NOT_PROFESSIONAL'
  | 'TARGET_PRIVATE'
  | 'TARGET_NOT_FOUND'
  | 'NO_OFFICIAL_SOURCE';

export type CompetitorLookupResult =
  | { eligibility: 'ELIGIBLE'; profile: CompetitorProfile; media: CompetitorMedia[] }
  | { eligibility: Exclude<CompetitorEligibility, 'ELIGIBLE'>; explanation: string };

// ---------------------------------------------------------------------------
// Results and capabilities
// ---------------------------------------------------------------------------

export interface ProviderError {
  /** Stable internal code, never the raw provider string (FR-002). */
  code: string;
  /** Sentence shown to the user. */
  userMessage: string;
  /** What the user can do about it. Empty states must offer a corrective action. */
  userAction: string;
  isRetryable: boolean;
  /** Set when the queue should defer rather than retry immediately (spec 10.3). */
  retryAfterSeconds?: number;
  /** Set when the failure should change the connection's status (ADR-0002 decision 4). */
  connectionStatus?: 'EXPIRED' | 'REVOKED' | 'INSUFFICIENT_SCOPE' | 'RATE_LIMITED';
  /** Provider detail for logs and support, not for display. */
  diagnostic?: string;
}

export type ProviderResult<T> = { ok: true; data: T } | { ok: false; error: ProviderError };

export function providerOk<T>(data: T): ProviderResult<T> {
  return { ok: true, data };
}

export function providerFail<T>(error: ProviderError): ProviderResult<T> {
  return { ok: false, error };
}

/**
 * What a connection can actually do right now, given the scopes App Review granted and the API
 * version in use. FR-004 requires profile visits and link actions to render "dynamically based on
 * current API availability", so capability is data rather than a compile-time assumption.
 */
export interface ProviderCapabilities {
  platform: Platform;
  apiVersion: string;
  canReadMediaInsights: boolean;
  canReadReach: boolean;
  canReadSaves: boolean;
  canReadAudienceDemographics: boolean;
  canReadAccountClicks: boolean;
  /** ADR-0001: false for Threads, and for Instagram without the Facebook Login grant. */
  canDiscoverCompetitors: boolean;
  /** Reasons a capability is off, keyed by capability name, for the empty states. */
  unavailableReasons: Readonly<Record<string, string>>;
}

export interface FetchWindow {
  since: IsoDate;
  until: IsoDate;
}

export interface ProviderContext {
  workspaceId: string;
  socialAccountId: string;
  platformUserId: string;
  /** Decrypted immediately before use and never logged. */
  accessToken: string;
  grantedScopes: readonly string[];
  apiVersion: string;
}

export interface PlatformProvider {
  readonly providerId: 'fixture' | 'live';
  readonly platform: Platform;

  capabilities(ctx: ProviderContext): ProviderCapabilities;
  fetchAccount(ctx: ProviderContext): Promise<ProviderResult<NormalizedAccount>>;
  fetchAccountSnapshot(ctx: ProviderContext): Promise<ProviderResult<NormalizedAccountSnapshot>>;
  fetchMedia(ctx: ProviderContext, window: FetchWindow): Promise<ProviderResult<NormalizedMediaPost[]>>;
  fetchMediaInsights(
    ctx: ProviderContext,
    platformMediaIds: readonly string[],
  ): Promise<ProviderResult<Map<string, NormalizedMediaMetrics>>>;
  fetchAudienceInsights(
    ctx: ProviderContext,
    window: FetchWindow,
  ): Promise<ProviderResult<NormalizedAudienceInsight[]>>;
}

/**
 * Separate from `PlatformProvider` because only Instagram implements it (ADR-0001). Keeping it out
 * of the main interface means a Threads adapter is not obliged to stub a method it can never
 * satisfy, and the absence is visible in the type system rather than at runtime.
 */
export interface CompetitorDiscoveryProvider {
  readonly platform: 'INSTAGRAM';
  lookup(ctx: ProviderContext, username: string): Promise<ProviderResult<CompetitorLookupResult>>;
}
