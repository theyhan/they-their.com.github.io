/**
 * Fixture provider (ADR-0007).
 *
 * Implements `PlatformProvider` over deterministic generated data, so Phases 2-3 can be built and
 * demonstrated while Meta App Review is outstanding, and so the SCR-001 demo dashboard runs the
 * same code path as the real product.
 *
 * ADR-0007 decision 3 is the important part: this generator deliberately produces the awkward
 * states, not a clean sample. Posts with missing reach, cohorts below the minimum sample, zero-view
 * posts, collection gaps, and a Threads history that starts at the platform epoch. Building against
 * tidy data is how Not Calculable states end up unimplemented and discovered during QA.
 */

import { THREADS_DATA_EPOCH, THREADS_DEMOGRAPHICS_MIN_FOLLOWERS } from '../../metrics/registry.js';
import { threadsCompetitorUnsupported } from '../errors.js';
import {
  providerFail,
  providerOk,
  type CompetitorDiscoveryProvider,
  type CompetitorLookupResult,
  type CompetitorMedia,
  type FetchWindow,
  type MediaType,
  type NormalizedAccount,
  type NormalizedAccountSnapshot,
  type NormalizedAudienceInsight,
  type NormalizedMediaMetrics,
  type NormalizedMediaPost,
  type Platform,
  type PlatformProvider,
  type ProviderCapabilities,
  type ProviderContext,
  type ProviderResult,
} from '../types.js';
import { createRng, seedFromString, type Rng } from './rng.js';

export interface FixtureOptions {
  /** Fixed reference date, so generated data does not shift between runs. */
  asOf: Date;
  /** Days of history to generate. */
  historyDays?: number;
  /** Extra entropy; the same seed always yields identical output. */
  seed?: string;
}

const IG_TYPES: readonly MediaType[] = ['IG_IMAGE', 'IG_CAROUSEL', 'IG_REEL', 'IG_STORY'];
const TH_TYPES: readonly MediaType[] = ['TH_TEXT', 'TH_IMAGE', 'TH_VIDEO'];

const TOPICS = ['routine', 'behind the scenes', 'product tips', 'customer story', 'industry news', 'ask me anything'];
const HOOKS = ['question', 'conclusion first', 'personal experience', 'contrarian take', 'plain information'];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(base: Date, days: number): Date {
  const next = new Date(base.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export class FixtureProvider implements PlatformProvider {
  readonly providerId = 'fixture' as const;

  constructor(
    readonly platform: Platform,
    private readonly options: FixtureOptions,
  ) {}

  private rng(salt: string): Rng {
    return createRng(seedFromString(`${this.options.seed ?? 'snsight'}:${this.platform}:${salt}`));
  }

  private get historyDays(): number {
    return this.options.historyDays ?? 120;
  }

  /**
   * Threads has no data before its epoch, so a fixture that generated a year of Threads history
   * would let us ship trend views that cannot exist in production.
   */
  private coverageStart(): string {
    const requested = addDays(this.options.asOf, -this.historyDays);
    if (this.platform === 'THREADS') {
      const epoch = new Date(`${THREADS_DATA_EPOCH}T00:00:00Z`);
      return isoDate(requested < epoch ? epoch : requested);
    }
    return isoDate(requested);
  }

  capabilities(ctx: ProviderContext): ProviderCapabilities {
    const unavailable: Record<string, string> = {};
    const hasInsights = ctx.grantedScopes.includes('insights');

    if (!hasInsights) {
      unavailable.canReadMediaInsights = 'The insights permission was not granted for this connection.';
    }
    if (this.platform === 'THREADS') {
      unavailable.canDiscoverCompetitors =
        'Threads offers no API for accounts you do not own, so competitor collection is unavailable (ADR-0001).';
      unavailable.canReadReach = 'Threads reports views rather than reach.';
      unavailable.canReadSaves = 'Threads has no saves metric.';
    }

    return {
      platform: this.platform,
      apiVersion: ctx.apiVersion,
      canReadMediaInsights: hasInsights,
      canReadReach: this.platform === 'INSTAGRAM' && hasInsights,
      canReadSaves: this.platform === 'INSTAGRAM' && hasInsights,
      canReadAudienceDemographics: hasInsights,
      canReadAccountClicks: this.platform === 'THREADS' && hasInsights,
      canDiscoverCompetitors: this.platform === 'INSTAGRAM' && ctx.grantedScopes.includes('business_discovery'),
      unavailableReasons: unavailable,
    };
  }

  async fetchAccount(ctx: ProviderContext): Promise<ProviderResult<NormalizedAccount>> {
    const rng = this.rng(`account:${ctx.platformUserId}`);
    const followers = rng.int(this.platform === 'THREADS' ? 40 : 900, 48_000);

    return providerOk({
      platform: this.platform,
      platformUserId: ctx.platformUserId,
      username: this.platform === 'INSTAGRAM' ? 'demo.studio' : 'demo.studio.threads',
      displayName: 'Demo Studio',
      biography: 'Sample account generated for the SNSight demo workspace.',
      profileImageUrl: null,
      isProfessional: true,
      followersCount: followers,
      followsCount: rng.int(80, 1200),
      mediaCount: rng.int(40, 400),
      dataCoverageStartsAt: this.coverageStart(),
    });
  }

  async fetchAccountSnapshot(ctx: ProviderContext): Promise<ProviderResult<NormalizedAccountSnapshot>> {
    const rng = this.rng(`snapshot:${ctx.platformUserId}:${isoDate(this.options.asOf)}`);
    const caps = this.capabilities(ctx);

    return providerOk({
      capturedOn: isoDate(this.options.asOf),
      followersCount: rng.int(1000, 48_000),
      followsCount: rng.int(80, 1200),
      mediaCount: rng.int(40, 400),
      accountClicks: caps.canReadAccountClicks ? rng.skewedInt(0, 900) : null,
    });
  }

  async fetchMedia(ctx: ProviderContext, window: FetchWindow): Promise<ProviderResult<NormalizedMediaPost[]>> {
    const caps = this.capabilities(ctx);
    const rng = this.rng(`media:${ctx.platformUserId}`);
    const coverageStart = this.coverageStart();
    const since = window.since < coverageStart ? coverageStart : window.since;

    const posts: NormalizedMediaPost[] = [];
    const types = this.platform === 'INSTAGRAM' ? IG_TYPES : TH_TYPES;
    const start = new Date(`${since}T00:00:00Z`);
    const end = new Date(`${window.until}T23:59:59Z`);

    // A deliberate two-week silent period, so inactive-period indicators (FR-008) and gap handling
    // have something real to render.
    const gapStart = addDays(this.options.asOf, -38);
    const gapEnd = addDays(this.options.asOf, -24);

    let cursor = start;
    let index = 0;
    while (cursor <= end) {
      const inGap = cursor >= gapStart && cursor <= gapEnd;
      const postsToday = inGap ? 0 : rng.bool(0.55) ? rng.int(1, 2) : 0;

      for (let n = 0; n < postsToday; n += 1) {
        index += 1;
        // Carousels are kept scarce on purpose: the cohort stays under the 8-post minimum, so the
        // performance index must render INSUFFICIENT_SAMPLE somewhere in the demo.
        const mediaType = rng.bool(0.08) && this.platform === 'INSTAGRAM' ? 'IG_CAROUSEL' : rng.pick(types.filter((t) => t !== 'IG_CAROUSEL'));
        const publishedAt = new Date(cursor.getTime());
        publishedAt.setUTCHours(rng.int(7, 22), rng.int(0, 59), 0, 0);

        posts.push({
          platform: this.platform,
          platformMediaId: `${this.platform.toLowerCase()}_fx_${index}`,
          mediaType,
          threadKind: this.platform === 'THREADS' ? (rng.bool(0.2) ? 'REPLY' : 'ORIGINAL') : null,
          parentPlatformMediaId: null,
          conversationDepth: this.platform === 'THREADS' ? rng.int(0, 4) : null,
          caption: `${rng.pick(HOOKS)}: ${rng.pick(TOPICS)} #${index}`,
          permalink: `https://example.invalid/${this.platform.toLowerCase()}/${index}`,
          mediaUrl: null,
          thumbnailUrl: null,
          childMediaUrls: mediaType === 'IG_CAROUSEL' ? [1, 2, 3].map((i) => `https://example.invalid/c/${index}/${i}`) : [],
          publishedAt: publishedAt.toISOString(),
          metrics: this.generateMetrics(rng, mediaType, caps),
        });
      }
      cursor = addDays(cursor, 1);
    }

    return providerOk(posts);
  }

  private generateMetrics(rng: Rng, mediaType: MediaType, caps: ProviderCapabilities): NormalizedMediaMetrics {
    const empty: NormalizedMediaMetrics = {
      likes: null,
      comments: null,
      saves: null,
      shares: null,
      views: null,
      reach: null,
      nonFollowerReach: null,
      replies: null,
      reposts: null,
      quotes: null,
    };

    // A brand-new post with no views yet: exercises ZERO_DENOMINATOR.
    const isZeroView = rng.bool(0.04);
    const views = isZeroView ? 0 : rng.skewedInt(120, 90_000);

    if (this.platform === 'INSTAGRAM') {
      // Reach is missing for a slice of posts, mimicking older media and partial permissions. This
      // is what forces the view fallback in ADR-0003 decision 3 to be handled in the UI.
      const reachMissing = !caps.canReadReach || rng.bool(0.12);
      const reach = reachMissing ? null : Math.round(views * (0.55 + rng.next() * 0.35));

      return {
        ...empty,
        likes: rng.skewedInt(3, Math.max(4, Math.round(views * 0.09))),
        comments: rng.skewedInt(0, Math.max(1, Math.round(views * 0.012))),
        saves: caps.canReadSaves ? rng.skewedInt(0, Math.max(1, Math.round(views * 0.02))) : null,
        shares: caps.canReadMediaInsights ? rng.skewedInt(0, Math.max(1, Math.round(views * 0.015))) : null,
        views,
        reach,
        // Stories do not report a follower breakdown in this fixture, so the metric is absent
        // rather than zero.
        nonFollowerReach: reach !== null && mediaType !== 'IG_STORY' ? Math.round(reach * (0.1 + rng.next() * 0.5)) : null,
      };
    }

    return {
      ...empty,
      likes: rng.skewedInt(1, Math.max(2, Math.round(views * 0.07))),
      comments: null, // Threads counts replies, not comments.
      views,
      replies: rng.skewedInt(0, Math.max(1, Math.round(views * 0.02))),
      reposts: rng.skewedInt(0, Math.max(1, Math.round(views * 0.01))),
      quotes: rng.skewedInt(0, Math.max(1, Math.round(views * 0.004))),
    };
  }

  async fetchMediaInsights(
    ctx: ProviderContext,
    platformMediaIds: readonly string[],
  ): Promise<ProviderResult<Map<string, NormalizedMediaMetrics>>> {
    const caps = this.capabilities(ctx);
    if (!caps.canReadMediaInsights) {
      return providerFail({
        code: 'INSUFFICIENT_SCOPE',
        userMessage: 'This account has not granted the permission needed for post insights.',
        userAction: 'Reconnect the account and approve the insights permission.',
        isRetryable: false,
        connectionStatus: 'INSUFFICIENT_SCOPE',
      });
    }

    const result = new Map<string, NormalizedMediaMetrics>();
    for (const id of platformMediaIds) {
      const rng = this.rng(`insight:${id}`);
      result.set(id, this.generateMetrics(rng, this.platform === 'INSTAGRAM' ? 'IG_IMAGE' : 'TH_TEXT', caps));
    }
    return providerOk(result);
  }

  async fetchAudienceInsights(
    ctx: ProviderContext,
    window: FetchWindow,
  ): Promise<ProviderResult<NormalizedAudienceInsight[]>> {
    const account = await this.fetchAccount(ctx);
    if (!account.ok) return providerFail(account.error);

    const followers = account.data.followersCount ?? 0;
    // Threads withholds demographics below 100 followers, so the fixture withholds them too and the
    // UI must show a below-threshold state rather than an empty chart.
    if (this.platform === 'THREADS' && followers < THREADS_DEMOGRAPHICS_MIN_FOLLOWERS) {
      return providerOk([]);
    }

    const rng = this.rng(`audience:${ctx.platformUserId}:${window.until}`);
    const countries = ['KR', 'US', 'JP', 'GB', 'DE'];
    const rows: NormalizedAudienceInsight[] = countries.map((country) => ({
      capturedOn: window.until,
      metricKey: 'audience.followers_by_country',
      dimension: 'country',
      dimensionValue: country,
      value: rng.skewedInt(10, Math.max(20, Math.round(followers * 0.4))),
    }));

    for (let hour = 0; hour < 24; hour += 1) {
      rows.push({
        capturedOn: window.until,
        metricKey: 'audience.online_followers',
        dimension: 'hour_of_day',
        dimensionValue: String(hour),
        value: rng.skewedInt(0, Math.max(5, Math.round(followers * 0.08))),
      });
    }

    return providerOk(rows);
  }
}

/**
 * Instagram-only competitor lookup (ADR-0001). Username prefixes select an eligibility outcome, so
 * every empty state in the UI can be reached without a live token:
 *
 *   `private_*`  -> TARGET_PRIVATE
 *   `personal_*` -> TARGET_NOT_PROFESSIONAL
 *   `unknown_*`  -> TARGET_NOT_FOUND
 *   anything else -> ELIGIBLE
 */
export class FixtureCompetitorProvider implements CompetitorDiscoveryProvider {
  readonly platform = 'INSTAGRAM' as const;

  constructor(private readonly options: FixtureOptions) {}

  async lookup(_ctx: ProviderContext, username: string): Promise<ProviderResult<CompetitorLookupResult>> {
    const handle = username.replace(/^@/, '');

    if (handle.startsWith('private_')) {
      return providerOk({
        eligibility: 'TARGET_PRIVATE',
        explanation: 'This account is private, so no public data is available.',
      });
    }
    if (handle.startsWith('personal_')) {
      return providerOk({
        eligibility: 'TARGET_NOT_PROFESSIONAL',
        explanation:
          'Only Instagram Business and Creator accounts can be analysed from public data. This is a personal account.',
      });
    }
    if (handle.startsWith('unknown_')) {
      return providerOk({
        eligibility: 'TARGET_NOT_FOUND',
        explanation: 'No Instagram account was found with this username.',
      });
    }

    const rng = createRng(seedFromString(`competitor:${handle}`));
    const followers = rng.int(2_000, 220_000);
    const media: CompetitorMedia[] = [];

    for (let i = 1; i <= 12; i += 1) {
      const publishedAt = addDays(this.options.asOf, -i * rng.int(1, 4));
      media.push({
        platformMediaId: `ig_comp_${handle}_${i}`,
        mediaType: rng.pick(['IG_IMAGE', 'IG_CAROUSEL', 'IG_REEL'] as const),
        caption: `${rng.pick(TOPICS)} post ${i}`,
        permalink: `https://example.invalid/ig/${handle}/${i}`,
        thumbnailUrl: null,
        publishedAt: publishedAt.toISOString(),
        // Public engagement only. There is no field here for reach, saves or shares, which is the
        // point: spec 3.2 is enforced by the type, not by remembering to omit them.
        metrics: {
          likes: rng.skewedInt(10, Math.round(followers * 0.06)),
          comments: rng.skewedInt(0, Math.round(followers * 0.004)),
        },
      });
    }

    return providerOk({
      eligibility: 'ELIGIBLE',
      profile: {
        platform: 'INSTAGRAM',
        platformUserId: `ig_comp_${handle}`,
        username: handle,
        displayName: handle.replace(/[._]/g, ' '),
        biography: 'Public business account generated for the demo workspace.',
        profileImageUrl: null,
        followersCount: followers,
        followsCount: rng.int(50, 2_000),
        mediaCount: rng.int(60, 900),
      },
      media,
    });
  }
}

/** Threads competitor lookup, kept explicit so the refusal is a documented code path. */
export function lookupThreadsCompetitor(): ProviderResult<CompetitorLookupResult> {
  return providerFail(threadsCompetitorUnsupported());
}
