/**
 * capability.js — the versioned provider capability registry the PRD asks for
 * ("do not hard-code a provider's model name, licensing policy, pricing, context
 * limit or output format into business logic").
 *
 * Business logic queries this module. Swapping a provider is a data change.
 */

export const REGISTRY_VERSION = '2026-08-01.1';

/**
 * `local-synth` is the engine that actually runs in this prototype. The other
 * entries are shape examples showing which fields must be captured before a
 * provider can be routed to; their values are placeholders to be filled from a
 * signed contract, never from marketing pages.
 */
export const PROVIDERS = {
  'local-synth': {
    id: 'local-synth',
    kind: 'music_generation',
    displayName: 'SoundFit Local Synth (in-browser)',
    modelId: 'procedural-arranger/0.4',
    status: 'active',
    capabilities: {
      asyncJobs: false,
      sectionRevision: true,
      instrumental: true,
      stems: false,
      vocals: 'synthetic_guide_only',
      maxDurationSeconds: 420,
      lyricConditioned: true,
      seedReproducible: true,
      outputFormats: ['wav16', 'wav24'],
      sampleRates: [44100],
    },
    commercial: {
      commercialUseAllowed: true,
      resaleAllowed: false,
      attributionRequired: false,
      trainingOnUserData: false,
      dataRetentionDays: 0,
      regions: ['*'],
      termsVersion: 'internal-1.0',
      contractOnFile: true,
    },
    cost: { perMinuteUsd: 0, perRequestUsd: 0, notes: 'client-side compute' },
    latency: { p50Seconds: 6, p95Seconds: 20 },
  },
  'provider-a': {
    id: 'provider-a',
    kind: 'music_generation',
    displayName: '(example) Hosted music API A',
    modelId: 'UNVERIFIED',
    status: 'evaluation',
    capabilities: {
      asyncJobs: true,
      sectionRevision: false,
      instrumental: true,
      stems: 'unknown',
      vocals: 'model_voices',
      maxDurationSeconds: 240,
      lyricConditioned: true,
      seedReproducible: 'unknown',
      outputFormats: ['mp3', 'wav16'],
      sampleRates: [44100],
    },
    commercial: {
      commercialUseAllowed: 'unverified',
      resaleAllowed: 'unverified',
      attributionRequired: 'unverified',
      trainingOnUserData: 'unverified',
      dataRetentionDays: null,
      regions: [],
      termsVersion: null,
      contractOnFile: false,
    },
    cost: { perMinuteUsd: null, perRequestUsd: null },
    latency: { p50Seconds: null, p95Seconds: null },
  },
};

export const ADAPTER_ROLES = [
  'TextModelAdapter',
  'MusicGenerationAdapter',
  'VoiceSynthesisAdapter',
  'AudioAnalysisAdapter',
  'SimilarityDetectionAdapter',
  'MasteringAdapter',
];

export const ACTIVE_ADAPTERS = {
  TextModelAdapter: { provider: 'local-template', modelId: 'lyric-template/0.4', promptVersion: 'lyric-v4' },
  MusicGenerationAdapter: { provider: 'local-synth', modelId: 'procedural-arranger/0.4' },
  VoiceSynthesisAdapter: { provider: 'local-synth', modelId: 'formant-guide/0.2', clonesRealPerson: false },
  AudioAnalysisAdapter: { provider: 'local-synth', modelId: 'peaks-rms/0.1' },
  SimilarityDetectionAdapter: { provider: 'local-symbolic', modelId: 'symbolic-interval-ngram/0.3.0' },
  MasteringAdapter: { provider: 'local-synth', modelId: 'numeric-master/0.2' },
};

/** A provider may only be routed paid traffic when every gate is satisfied. */
export function readinessGate(providerId) {
  const p = PROVIDERS[providerId];
  if (!p) return { ready: false, blocking: ['unknown_provider'] };
  const c = p.commercial;
  const blocking = [];
  if (c.commercialUseAllowed !== true) blocking.push('commercial_use_unverified');
  if (!c.contractOnFile) blocking.push('no_contract_on_file');
  if (c.trainingOnUserData !== false) blocking.push('training_on_user_data_unresolved');
  if (c.dataRetentionDays === null) blocking.push('retention_unknown');
  if (!c.regions.length) blocking.push('regions_unknown');
  if (p.cost.perMinuteUsd === null && p.cost.perRequestUsd === null) blocking.push('cost_unknown');
  return { ready: blocking.length === 0, blocking, provider: p };
}

/**
 * Decide how a revision will actually be executed given real capabilities.
 * This is the "capability detection and clearly scoped full-regeneration
 * fallback" mitigation from §23, made executable.
 */
export function resolveExecutionPlan({ providerId, scope, sectionCount, changedSections, durationSeconds }) {
  const p = PROVIDERS[providerId];
  if (!p) throw new Error('unknown provider');
  const supportsPatch = p.capabilities.sectionRevision === true;
  const mode = supportsPatch && scope === 'section' && changedSections < sectionCount
    ? 'section_patch'
    : 'full_regenerate';
  const workUnits = mode === 'section_patch' ? changedSections : sectionCount;
  const minutes = (durationSeconds / 60) * (workUnits / Math.max(1, sectionCount));
  const cost = (p.cost.perMinuteUsd ?? 0) * minutes + (p.cost.perRequestUsd ?? 0);
  return {
    mode,
    workUnits,
    sectionCount,
    estimatedSeconds: Math.max(3, Math.round((p.latency.p50Seconds ?? 30) * (workUnits / Math.max(1, sectionCount)))),
    estimatedCostUsd: +cost.toFixed(4),
    userMessage: mode === 'section_patch'
      ? { ko: `선택한 ${changedSections}개 구간만 다시 만듭니다.`, en: `Re-rendering only ${changedSections} section(s).` }
      : { ko: '이 수정은 곡 전체를 다시 생성해야 합니다.', en: 'This revision requires regenerating the whole song.' },
    fallbackReason: supportsPatch ? null : 'provider_does_not_support_section_revision',
  };
}

export function capabilityMatrix() {
  return Object.values(PROVIDERS).map((p) => ({
    id: p.id,
    displayName: p.displayName,
    status: p.status,
    ...p.capabilities,
    commercialUseAllowed: p.commercial.commercialUseAllowed,
    contractOnFile: p.commercial.contractOnFile,
    ready: readinessGate(p.id).ready,
  }));
}
