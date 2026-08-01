/**
 * Provider selection (ADR-0007 decision 4).
 *
 * One factory, chosen by configuration, so the SCR-001 demo workspace and a live workspace run the
 * same code path and the demo cannot drift from the product. Live adapters are added here as App
 * Review completes; until then requesting them fails loudly rather than returning empty data that
 * would look like an account with no activity.
 */

export * from './types.js';
export * from './errors.js';
export { FixtureProvider, FixtureCompetitorProvider, lookupThreadsCompetitor } from './fixture/provider.js';
export { createRng, seedFromString } from './fixture/rng.js';

import { FixtureCompetitorProvider, FixtureProvider, type FixtureOptions } from './fixture/provider.js';
import type { CompetitorDiscoveryProvider, Platform, PlatformProvider } from './types.js';

export type ProviderMode = 'fixture' | 'live';

export interface ProviderFactoryOptions {
  mode: ProviderMode;
  /** Required in fixture mode. */
  fixture?: FixtureOptions;
}

export function resolveProviderMode(raw: string | undefined): ProviderMode {
  // Defaults to fixture: an unset variable must not silently attempt live API calls with whatever
  // token happens to be present.
  if (raw === 'live') return 'live';
  return 'fixture';
}

export function createPlatformProvider(platform: Platform, options: ProviderFactoryOptions): PlatformProvider {
  if (options.mode === 'fixture') {
    if (!options.fixture) throw new Error('fixture mode requires FixtureOptions (asOf is mandatory for determinism)');
    return new FixtureProvider(platform, options.fixture);
  }
  throw new Error(
    `Live ${platform} adapter is not implemented yet. It is gated on Meta App Review (ADR-0002); ` +
      'run with SNSIGHT_PROVIDER=fixture until the adapter lands.',
  );
}

/**
 * Returns null for Threads rather than throwing: having no competitor discovery is the expected,
 * documented state for that platform (ADR-0001), not an error condition.
 */
export function createCompetitorProvider(
  platform: Platform,
  options: ProviderFactoryOptions,
): CompetitorDiscoveryProvider | null {
  if (platform === 'THREADS') return null;
  if (options.mode === 'fixture') {
    if (!options.fixture) throw new Error('fixture mode requires FixtureOptions');
    return new FixtureCompetitorProvider(options.fixture);
  }
  throw new Error('Live Instagram competitor adapter is not implemented yet (gated on Meta App Review).');
}
