/**
 * store.js — project state machine, audit log, KPI event taxonomy, idempotency
 * ledger and cost ledger. Persistence is localStorage in the prototype; the
 * shapes are the ones a Postgres schema should mirror.
 */

import { redact } from '../domain/story.js';

const KEY = 'soundfit.v1';

/* ---------------------- generation state machine ---------------------- */

export const STATES = {
  intake: ['story_approved', 'deleted', 'expired'],
  story_approved: ['lyrics_draft', 'intake', 'deleted'],
  lyrics_draft: ['lyrics_approved', 'story_approved', 'deleted', 'expired'],
  lyrics_approved: ['generating', 'lyrics_draft', 'deleted'],
  generating: ['safety_check', 'generation_failed'],
  generation_failed: ['generating', 'refunded', 'deleted'],
  safety_check: ['comparison', 'blocked', 'quarantined'],
  blocked: ['lyrics_draft', 'refunded', 'deleted'],
  quarantined: ['generating', 'refunded', 'deleted'],
  comparison: ['revising', 'finalized', 'deleted'],
  revising: ['safety_check', 'comparison', 'generation_failed'],
  finalized: ['licensed', 'revising', 'deleted'],
  licensed: ['delivered', 'refunded'],
  delivered: ['refunded', 'deleted'],
  refunded: ['deleted'],
  expired: ['deleted'],
  deleted: [],
};

export function canTransition(from, to) {
  return (STATES[from] || []).includes(to);
}

/* ---------------------- event taxonomy ---------------------- */

/** Every KPI in §22 must map to at least one event here. */
export const EVENTS = {
  onboarding_started: { kpi: [] },
  dna_pairwise_answered: { kpi: [] },
  dna_onboarding_completed: { kpi: [] },
  dna_preference_corrected: { kpi: ['dna_correction_rate'] },
  dna_signal_deleted: { kpi: [] },
  dna_reset: { kpi: [] },
  project_created: { kpi: ['story_intake_completion_rate'] },
  story_step_completed: { kpi: ['story_intake_completion_rate'] },
  story_approved: { kpi: ['story_intake_completion_rate'] },
  request_screened: { kpi: ['screening_block_rate'] },
  lyrics_generated: { kpi: [] },
  lyrics_edited: { kpi: ['lyric_edit_distance'] },
  lyrics_line_locked: { kpi: [] },
  lyrics_section_regenerated: { kpi: ['regeneration_rate'] },
  lyrics_approved: { kpi: ['lyric_approval_rate'] },
  generation_started: { kpi: ['paid_conversion_rate'] },
  generation_progress: { kpi: [] },
  generation_completed: { kpi: ['generation_success_rate'] },
  generation_failed: { kpi: ['generation_success_rate'] },
  similarity_checked: { kpi: ['similarity_failure_rate'] },
  variant_played: { kpi: [] },
  variant_selected: { kpi: ['ab_selection_rate'] },
  revision_requested: { kpi: ['revisions_per_song'] },
  revision_completed: { kpi: ['revisions_per_song'] },
  finalized: { kpi: [] },
  license_issued: { kpi: ['license_attach_rate'] },
  download_completed: { kpi: ['final_download_rate'] },
  share_created: { kpi: ['recipient_share_rate'] },
  share_opened: { kpi: ['recipient_share_rate'] },
  rating_submitted: { kpi: ['first_generation_rating'] },
  project_deleted: { kpi: [] },
  refund_requested: { kpi: ['refund_rate'] },
  abuse_reported: { kpi: [] },
};

/* ---------------------- store ---------------------- */

function blank() {
  return {
    schema: 'soundfit.local/1.1',
    user: { id: 'usr_local', locale: 'ko', consentVersion: '2026-08-01', plan: 'free' },
    profile: null,
    projects: {},
    currentProjectId: null,
    events: [],
    audit: [],
    idempotency: {},
    costLedger: [],
  };
}

let state = null;
const listeners = new Set();

export function load() {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? { ...blank(), ...JSON.parse(raw) } : blank();
  } catch (e) {
    state = blank();
  }
  return state;
}

export function save() {
  try {
    // keep storage bounded: audio buffers are never persisted
    const copy = { ...state, events: state.events.slice(-400), audit: state.audit.slice(-400) };
    localStorage.setItem(KEY, JSON.stringify(copy));
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('persist failed', e);
  }
  listeners.forEach((fn) => fn(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function get() {
  return load();
}

export function update(mutator) {
  const s = load();
  mutator(s);
  save();
  return s;
}

/* ---------------------- events + audit ---------------------- */

export function emit(name, payload = {}) {
  if (!EVENTS[name]) throw new Error('unregistered event: ' + name);
  const s = load();
  const evt = {
    id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    at: new Date().toISOString(),
    projectId: payload.projectId ?? s.currentProjectId ?? null,
    kpi: EVENTS[name].kpi,
    props: sanitizeProps(payload),
  };
  s.events.push(evt);
  save();
  return evt;
}

/** Analytics never receives raw story text. */
function sanitizeProps(payload) {
  const out = {};
  for (const [k, v] of Object.entries(payload)) {
    if (k === 'projectId') continue;
    if (typeof v === 'string') {
      out[k] = v.length > 60 ? redact(v).slice(0, 60) + '…' : redact(v);
    } else if (typeof v === 'number' || typeof v === 'boolean' || v === null) {
      out[k] = v;
    } else if (Array.isArray(v)) {
      out[k] = v.slice(0, 12).map((x) => (typeof x === 'string' ? redact(x) : x));
    } else if (typeof v === 'object') {
      out[k] = '[object]';
    }
  }
  return out;
}

export function audit({ actor = 'usr_local', action, target, metadata = {} }) {
  const s = load();
  const entry = {
    id: `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    actor,
    action,
    target,
    metadata: sanitizeProps(metadata),
    at: new Date().toISOString(),
  };
  s.audit.push(entry);
  save();
  return entry;
}

/* ---------------------- projects ---------------------- */

export function createProject({ occasion, occasionLabel, privacyMode = 'private' }) {
  const s = load();
  const id = `prj_${Date.now().toString(36)}`;
  s.projects[id] = {
    id,
    occasion,
    occasionLabel,
    privacyMode,
    status: 'intake',
    recipientAlias: null,
    brief: null,
    lyrics: null,
    spec: null,
    variants: {},
    selectedVariant: null,
    revisions: [],
    similarity: null,
    license: null,
    provenance: null,
    entitlement: { paid: false, includedRevisions: 2, usedRevisions: 0, orderId: null },
    rating: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stateHistory: [{ state: 'intake', at: new Date().toISOString() }],
  };
  s.currentProjectId = id;
  save();
  emit('project_created', { projectId: id, occasion });
  audit({ action: 'project.create', target: id, metadata: { occasion } });
  return s.projects[id];
}

export function currentProject() {
  const s = load();
  return s.currentProjectId ? s.projects[s.currentProjectId] : null;
}

export function setProjectState(projectId, next, meta = {}) {
  const s = load();
  const p = s.projects[projectId];
  if (!p) throw new Error('no project');
  if (p.status === next) return p;
  if (!canTransition(p.status, next)) {
    throw new Error(`illegal transition ${p.status} -> ${next}`);
  }
  p.status = next;
  p.updatedAt = new Date().toISOString();
  p.stateHistory.push({ state: next, at: p.updatedAt, ...meta });
  save();
  audit({ action: 'project.state', target: projectId, metadata: { to: next } });
  return p;
}

export function patchProject(projectId, patch) {
  const s = load();
  const p = s.projects[projectId];
  if (!p) throw new Error('no project');
  Object.assign(p, patch, { updatedAt: new Date().toISOString() });
  save();
  return p;
}

export function deleteProject(projectId) {
  const s = load();
  delete s.projects[projectId];
  if (s.currentProjectId === projectId) s.currentProjectId = null;
  save();
  emit('project_deleted', { projectId });
  audit({ action: 'project.delete', target: projectId, metadata: { hardDelete: true } });
}

/* ---------------------- idempotency + cost ---------------------- */

/**
 * Paid operations must be safe to retry. Callers pass a stable key derived from
 * (projectId, operation, inputs hash). A duplicate call returns the stored
 * result instead of charging or generating again.
 */
export async function withIdempotency(key, fn, meta = {}) {
  const s = load();
  const existing = s.idempotency[key];
  if (existing && existing.status === 'completed') {
    audit({ action: 'idempotency.replay', target: key, metadata: { operation: meta.operation } });
    return { result: existing.result, replayed: true };
  }
  if (existing && existing.status === 'in_flight') {
    const ageMs = Date.now() - new Date(existing.startedAt).getTime();
    if (ageMs < 120000) {
      return { result: null, inFlight: true, replayed: false };
    }
    // stale in-flight record: a previous attempt died. Reconcile instead of double-charging.
    audit({ action: 'idempotency.reclaim', target: key, metadata: { ageMs } });
  }
  s.idempotency[key] = { status: 'in_flight', startedAt: new Date().toISOString(), operation: meta.operation || null };
  save();
  try {
    const result = await fn();
    s.idempotency[key] = {
      status: 'completed',
      startedAt: s.idempotency[key].startedAt,
      completedAt: new Date().toISOString(),
      operation: meta.operation || null,
      result: serializableResult(result),
    };
    save();
    return { result, replayed: false };
  } catch (err) {
    s.idempotency[key] = { status: 'failed', failedAt: new Date().toISOString(), error: String(err.message || err) };
    save();
    throw err;
  }
}

function serializableResult(r) {
  if (r == null) return null;
  if (typeof r === 'object') {
    const { pcm, buffer, peaks, ...rest } = r;
    return rest;
  }
  return r;
}

export function recordCost({ projectId, stage, provider, model, units, costUsd, ms, meta = {} }) {
  const s = load();
  s.costLedger.push({
    id: `cst_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    projectId,
    stage,
    provider,
    model,
    units,
    costUsd: +(costUsd || 0).toFixed(5),
    ms: ms ?? null,
    at: new Date().toISOString(),
    meta,
  });
  save();
}

export function projectCost(projectId) {
  const s = load();
  const rows = s.costLedger.filter((r) => r.projectId === projectId);
  return {
    rows,
    totalUsd: +rows.reduce((a, r) => a + r.costUsd, 0).toFixed(5),
    totalMs: rows.reduce((a, r) => a + (r.ms || 0), 0),
  };
}

/* ---------------------- KPI rollup ---------------------- */

export function kpiSnapshot() {
  const s = load();
  const count = (n) => s.events.filter((e) => e.name === n).length;
  const projects = Object.values(s.projects);
  const started = Math.max(1, count('project_created'));
  return {
    projects: projects.length,
    storyIntakeCompletion: +(count('story_approved') / started).toFixed(2),
    lyricApprovalRate: count('lyrics_generated') ? +(count('lyrics_approved') / count('lyrics_generated')).toFixed(2) : 0,
    paidConversion: +(count('license_issued') / started).toFixed(2),
    downloadRate: +(count('download_completed') / started).toFixed(2),
    revisionsPerSong: count('revision_completed') && projects.length
      ? +(count('revision_completed') / projects.length).toFixed(2) : 0,
    abSelection: (() => {
      const sel = s.events.filter((e) => e.name === 'variant_selected');
      const a = sel.filter((e) => e.props.variant === 'A').length;
      return sel.length ? { a: +(a / sel.length).toFixed(2), b: +(1 - a / sel.length).toFixed(2), n: sel.length } : null;
    })(),
    similarityFailureRate: count('similarity_checked')
      ? +(s.events.filter((e) => e.name === 'similarity_checked' && e.props.decision !== 'pass').length / count('similarity_checked')).toFixed(2)
      : 0,
    generationFailureRate: count('generation_started')
      ? +(count('generation_failed') / count('generation_started')).toFixed(2) : 0,
  };
}

export function resetAll() {
  state = blank();
  save();
}
