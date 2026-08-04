/**
 * Headless checks for the pure logic layer. Run: node soundfit/tests/logic.test.mjs
 * (Audio rendering itself needs a browser; everything below is deterministic JS.)
 */

import assert from 'node:assert/strict';

import { chordsForSection, snapToScale, noteNameToMidi, SCALES } from '../assets/js/audio/theory.js';
import { arrange, fitStructure } from '../assets/js/audio/arranger.js';
import { similarityCheck, REFERENCE_MOTIFS } from '../assets/js/audio/fingerprint.js';
import { buildBrief, scanSensitive, persistable, redact } from '../assets/js/domain/story.js';
import * as L from '../assets/js/domain/lyrics.js';
import * as DNA from '../assets/js/domain/dna.js';
import { deriveSpec, makeVariantPair, applyRevision, diffScores, matchIntent } from '../assets/js/domain/spec.js';
import { screenRequest, checkVoiceRequest, issueLicense, buildProvenance } from '../assets/js/domain/rights.js';
import { readinessGate, resolveExecutionPlan, capabilityMatrix } from '../assets/js/domain/capability.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (e) {
    failures.push({ name, e });
    console.log('  FAIL ' + name + '\n       ' + e.message);
  }
}

const ANSWERS = {
  recipient: '아내 미나',
  relationship: '10년째 함께인 배우자',
  memory: '첫 겨울에 막차를 놓치고 한 시간을 걸었던 밤, 서로 장갑을 바꿔 끼고 웃었어',
  feeling: '고맙고 조금 울컥하고 결국 웃게 되는',
  details: '2016년 3월, 연희동',
  exclude: '병원, 전 직장',
  avoidTone: '너무 슬픈 느낌',
};

console.log('\n[story]');
const brief = buildBrief({ occasion: 'anniversary', answers: ANSWERS, locale: 'ko' });

test('never_store fields are kept out of approvedFacts', () => {
  assert.ok(!brief.approvedFacts.find((f) => f.id === 'exclude'));
  assert.equal(brief.ephemeral.exclude, '병원, 전 직장');
});

test('prohibited details are parsed into a list', () => {
  assert.deepEqual(brief.prohibitedDetails, ['병원', '전 직장']);
});

test('recipient is reduced to an alias', () => {
  assert.equal(brief.recipientAlias, '미나');
});

test('sensitive scan catches health + phone + national id patterns', () => {
  const hits = scanSensitive('수술 후에 010-1234-5678로 연락 주세요 900101-1234567');
  const ids = hits.map((h) => h.type);
  assert.ok(ids.includes('health'), 'health');
  assert.ok(ids.includes('phone'), 'phone');
  assert.ok(ids.includes('rrn'), 'rrn');
});

test('redaction removes PII from log-bound text', () => {
  assert.ok(!redact('a@b.com 010-1111-2222').includes('a@b.com'));
});

test('strict privacy mode drops sensitive values from persistence', () => {
  const strict = persistable({ ...brief, privacyMode: 'strict' });
  const details = strict.approvedFacts.find((f) => f.id === 'details');
  assert.equal(details.value, '[not stored]');
  assert.equal(strict.ephemeral, undefined);
});

console.log('\n[lyrics]');
let lyrics = L.generateLyrics(brief, { lang: 'ko', seed: 12345 });

test('draft has the planned sections and no unfilled slots', () => {
  assert.equal(lyrics.sections.length, L.SECTION_PLAN.length);
  const text = L.plainText(lyrics);
  assert.ok(!text.includes('{name}'), 'no unreplaced {name}');
  assert.ok(text.includes('미나'), 'recipient alias used');
});

test('every line has a positive syllable count', () => {
  for (const l of L.allLines(lyrics)) assert.ok(l.syllables > 0, l.text);
});

test('korean syllable counting counts hangul blocks', () => {
  assert.equal(L.countSyllables('사랑해', 'ko'), 3);
  assert.equal(L.countSyllables('hello world', 'en'), 3);
});

test('user memory wording is carried into verse 1', () => {
  const v1 = lyrics.sections.find((s) => s.kind === 'verse' && s.index === 1);
  assert.ok(v1.lines.some((l) => l.origin === 'story'), 'a story-derived line exists');
});

test('story coverage is measured per fact', () => {
  const cov = L.storyCoverage(lyrics, brief);
  assert.ok(cov.overall > 0);
  assert.ok(cov.perFact.length >= 3);
});

test('generation is deterministic for a fixed seed', () => {
  const again = L.generateLyrics(brief, { lang: 'ko', seed: 12345 });
  assert.equal(L.plainText(again), L.plainText(lyrics));
});

test('locked lines survive section regeneration', () => {
  const target = lyrics.sections[0].lines[0];
  let l2 = L.toggleLock(lyrics, target.id);
  l2 = L.regenerateSection(l2, brief, 'verse', 1, 99);
  const after = l2.sections[0].lines.find((l) => l.id === target.id);
  assert.ok(after, 'locked line still present');
  assert.equal(after.text, target.text);
});

test('editing a line is measured as edit distance', () => {
  const first = L.allLines(lyrics)[0];
  const edited = L.editLine(lyrics, first.id, first.text + ' 정말로');
  const stats = L.editDistanceStats(edited);
  assert.ok(stats.totalDistance >= 4, 'distance recorded');
  assert.equal(stats.editedLines, 1);
});

test('prohibited detail blocks approval', () => {
  const first = L.allLines(lyrics)[0];
  const bad = L.editLine(lyrics, first.id, '그 병원 앞에서 기다렸지');
  const review = L.reviewLyrics(bad, brief);
  assert.equal(review.canApprove, false);
  assert.equal(review.violations[0].banned, '병원');
});

test('clean lyrics can be approved', () => {
  const review = L.reviewLyrics(lyrics, brief);
  assert.equal(review.canApprove, true, JSON.stringify(review.violations));
});

test('language adaptation keeps section shape', () => {
  const ja = L.adaptLanguage(lyrics, brief, 'ja');
  assert.equal(ja.sections.length, lyrics.sections.length);
  assert.equal(ja.language, 'ja');
});

console.log('\n[music dna]');
let profile = DNA.emptyProfile();

test('a single signal never reaches confident inference', () => {
  const p = DNA.addSignal(profile, { source: 'like', dimension: 'genre', value: 'city_pop' });
  const inf = DNA.inferPreferences(p);
  assert.ok(inf.genre.confidence <= 0.44, inf.genre.confidence);
  assert.equal(DNA.resolveProfile(p).resolved.genre.source, 'default');
});

test('repeated agreeing signals raise confidence above threshold', () => {
  let p = profile;
  for (let i = 0; i < 4; i++) {
    p = DNA.addSignal(p, { source: 'onboarding_pairwise', dimension: 'genre', value: 'city_pop' });
  }
  const r = DNA.resolveProfile(p);
  assert.equal(r.resolved.genre.source, 'inferred');
  assert.equal(r.resolved.genre.value, 'city_pop');
  assert.ok(r.resolved.genre.confidence >= DNA.INFER_THRESHOLD);
  profile = p;
});

test('explicit choice always wins over inference', () => {
  const p = DNA.setExplicit(profile, 'genre', 'acoustic_ballad');
  const r = DNA.resolveProfile(p);
  assert.equal(r.resolved.genre.source, 'explicit');
  assert.equal(r.resolved.genre.value, 'acoustic_ballad');
  assert.equal(r.inferred.genre.value, 'city_pop', 'inference is still visible, just not applied');
});

test('deleting signals lowers confidence back down', () => {
  let p = profile;
  const ids = p.signals.map((s) => s.id);
  for (const id of ids.slice(0, 3)) p = DNA.deleteSignal(p, id);
  const inf = DNA.inferPreferences(p);
  assert.ok(!inf.genre || inf.genre.confidence <= 0.44);
});

test('exclusions filter the resolved instrumentation', () => {
  let p = DNA.setExplicit(profile, 'instrumentation', ['piano', 'drums']);
  p = DNA.addExclusion(p, 'instruments', 'drums');
  const r = DNA.resolveProfile(p);
  assert.deepEqual(r.resolved.instrumentation.value, ['piano']);
});

test('old signals decay', () => {
  let p = DNA.emptyProfile();
  for (let i = 0; i < 4; i++) p = DNA.addSignal(p, { source: 'like', dimension: 'mood', value: 'calm' });
  const fresh = DNA.inferPreferences(p).mood.confidence;
  const later = DNA.inferPreferences(p, Date.now() + 400 * 86400000).mood.confidence;
  assert.ok(later < fresh, `${later} < ${fresh}`);
});

test('profile export includes provenance for every dimension', () => {
  const json = JSON.parse(DNA.exportProfile(profile));
  assert.equal(Object.keys(json.effective).length, Object.keys(DNA.DIMENSIONS).length);
  assert.ok(json.signals.length >= 1);
});

console.log('\n[spec + A/B]');
const resolved = DNA.resolveProfile(DNA.setExplicit(DNA.emptyProfile(), 'genre', 'acoustic_ballad')).resolved;
const spec = deriveSpec(resolved, brief, { targetSeconds: 190 });

test('spec derivation is deterministic', () => {
  const again = deriveSpec(resolved, brief, { targetSeconds: 190 });
  assert.equal(again.seed, spec.seed);
  assert.equal(again.id, spec.id);
});

const pair = makeVariantPair(spec, 'ko');

test('A and B differ on exactly the declared axes and nothing else', () => {
  assert.equal(pair.axes.length, 2);
  const a = { ...pair.a, variation: null, instruments: null, variantId: null };
  const b = { ...pair.b, variation: null, instruments: null, variantId: null };
  assert.deepEqual(a, b, 'everything outside variation/instruments is identical');
  const differing = Object.keys(pair.a.variation).filter((k) => pair.a.variation[k] !== pair.b.variation[k]);
  assert.deepEqual(differing.sort(), [...pair.axes].sort());
});

test('difference is explainable in both locales', () => {
  const ko = pair.explain('ko');
  const en = pair.explain('en');
  assert.equal(ko.a.length, 2);
  assert.ok(ko.a.every((s) => typeof s === 'string' && s.length > 4));
  assert.ok(en.b.every((s) => typeof s === 'string' && s.length > 4));
});

test('free-text revision maps to an intent', () => {
  assert.equal(matchIntent('후렴을 더 힘있게 해주세요'), 'chorus_more_powerful');
  assert.equal(matchIntent('드럼 좀 줄여줘'), 'reduce_drums');
  assert.equal(matchIntent('make the vocal warmer'), 'vocal_warmer');
  assert.equal(matchIntent('아무 말'), null);
});

console.log('\n[arranger]');
const scoreA = arrange(pair.a, lyrics);
const scoreB = arrange(pair.b, lyrics);

test('structure lands close to the requested length', () => {
  assert.ok(Math.abs(scoreA.duration - 190) < 20, `duration ${scoreA.duration.toFixed(1)}s`);
});

test('sections are contiguous with no gaps', () => {
  let t = 0;
  for (const s of scoreA.sections) {
    assert.ok(Math.abs(s.startTime - t) < 1e-6, `${s.id} starts at ${s.startTime}, expected ${t}`);
    t += s.duration;
  }
});

test('a chorus exists and carries the lyric line timings', () => {
  const chorus = scoreA.sections.find((s) => s.kind === 'chorus');
  assert.ok(chorus, 'chorus present');
  assert.ok(chorus.lineTimings.length >= 3, 'lyric lines are timed for sync playback');
  assert.ok(chorus.tracks.vocal.length > 0, 'vocal guide notes exist');
});

test('all notes stay inside their section window', () => {
  for (const s of scoreA.sections) {
    for (const [name, notes] of Object.entries(s.tracks)) {
      for (const n of notes) {
        assert.ok(n.t >= -0.001, `${s.id}/${name} negative time`);
        assert.ok(n.t < s.durationBeats + 0.001, `${s.id}/${name} note past section end`);
        assert.ok(n.midi > 20 && n.midi < 108, `${s.id}/${name} midi out of range: ${n.midi}`);
      }
    }
  }
});

test('arranging twice gives identical cache keys', () => {
  const again = arrange(pair.a, lyrics);
  assert.deepEqual(again.sections.map((s) => s.cacheKey), scoreA.sections.map((s) => s.cacheKey));
});

test('A and B actually sound different', () => {
  const same = scoreA.sections.filter((s, i) => s.cacheKey === scoreB.sections[i]?.cacheKey).length;
  assert.ok(same < scoreA.sections.length / 2, `${same} identical sections out of ${scoreA.sections.length}`);
});

console.log('\n[section-local revision]');
test('chorus revision only dirties chorus sections', () => {
  const { spec: revised } = applyRevision(pair.a, 'chorus_more_powerful');
  const next = arrange(revised, lyrics);
  const diff = diffScores(scoreA, next);
  assert.ok(diff.changed.length > 0, 'something changed');
  assert.ok(diff.changed.every((id) => id.startsWith('chorus')), 'changed: ' + diff.changed.join(','));
  assert.ok(diff.unchanged.length > diff.changed.length, 'most sections are reused');
});

test('emotional-chorus revision is also scoped to the chorus', () => {
  const { spec: revised } = applyRevision(pair.a, 'chorus_more_emotional');
  const diff = diffScores(scoreA, arrange(revised, lyrics));
  assert.ok(diff.changed.length > 0);
  assert.ok(diff.changed.every((id) => id.startsWith('chorus')), 'changed: ' + diff.changed.join(','));
});

test('drum revision dirties only sections that contain drums', () => {
  const { spec: revised } = applyRevision(pair.a, 'reduce_drums');
  const next = arrange(revised, lyrics);
  const diff = diffScores(scoreA, next);
  const withoutDrums = scoreA.sections.filter((s) => !s.tracks.drums).map((s) => s.id);
  assert.ok(diff.changed.length > 0);
  for (const id of diff.changed) assert.ok(!withoutDrums.includes(id), id + ' has no drums but was dirtied');
});

test('editing one lyric line dirties only that section', () => {
  const verse2 = lyrics.sections.find((s) => s.kind === 'verse' && s.index === 2);
  const edited = L.editLine(lyrics, verse2.lines[0].id, '그날의 우리를 아직 기억해 아주 오래');
  const diff = diffScores(scoreA, arrange(pair.a, edited));
  assert.deepEqual(diff.changed, ['verse2'], 'changed: ' + diff.changed.join(','));
});

test('structural revision is honestly reported as a full re-render', () => {
  const { spec: revised } = applyRevision(pair.a, 'add_guitar_solo');
  const next = arrange(revised, lyrics);
  const diff = diffScores(scoreA, next);
  assert.equal(diff.structural, true);
});

test('instrumental version removes vocal tracks', () => {
  const { spec: revised } = applyRevision(pair.a, 'instrumental');
  const next = arrange(revised, lyrics);
  assert.ok(next.sections.every((s) => !s.tracks.vocal), 'no vocal track remains');
  assert.ok(next.sections.some((s) => s.tracks.lead), 'a lead instrument covers the melody');
});

console.log('\n[similarity gate]');
test('an original generated melody passes the screen', () => {
  const res = similarityCheck(scoreA);
  assert.equal(res.decision, 'pass', `score ${res.score} vs ${res.matches[0]?.title}`);
});

test('a melody copied from a reference is quarantined', () => {
  const motif = REFERENCE_MOTIFS[0];
  let midi = 60;
  const notes = motif.intervals.concat(motif.intervals).map((iv, i) => {
    midi += iv;
    return { t: i, d: 1, midi, vel: 0.8 };
  });
  const fake = {
    sections: [{ id: 'chorus1', startBeat: 0, tracks: { vocal: notes } }],
  };
  const res = similarityCheck(fake);
  assert.equal(res.decision, 'quarantine', `score ${res.score}`);
  assert.equal(res.matches[0].id, motif.id);
});

console.log('\n[rights]');
test('voice-clone requests are blocked', () => {
  const r = screenRequest('내 친구 목소리 복제해서 불러줘');
  assert.equal(r.decision, 'block');
});

test('exact-copy requests are blocked', () => {
  assert.equal(screenRequest('그 노래 그대로 만들어줘').decision, 'block');
});

test('deceased-voice requests are blocked', () => {
  assert.equal(screenRequest('돌아가신 아버지 목소리로 불러주세요').decision, 'block');
});

test('"sing like <person>" is transformed into attributes, not refused outright', () => {
  const r = screenRequest('유명한 가수처럼 불러줘');
  assert.equal(r.decision, 'transform');
  assert.ok(r.suggestedAttributes.length >= 3);
  assert.ok(r.userMessage.ko.length > 10);
});

test('an ordinary request is allowed', () => {
  assert.equal(screenRequest('따뜻한 피아노 발라드로 만들어주세요').decision, 'allow');
});

test('every voice mode that clones a person is disabled in the MVP', () => {
  for (const mode of ['self_voice_clone', 'third_party_clone', 'licensed_stock_voice']) {
    const r = checkVoiceRequest({ mode, occasion: 'anniversary', consent: true });
    assert.equal(r.allowed, false, mode);
    assert.ok(r.requiredControls.length >= 5, mode + ' lists the controls required first');
  }
  assert.equal(checkVoiceRequest({ mode: 'synthetic_guide', occasion: 'anniversary' }).allowed, true);
});

test('licence separates contractual permission from copyright ownership', () => {
  const lic = issueLicense({ projectId: 'p1', tier: 'personal', locale: 'ko' });
  assert.ok(lic.permittedUses.length >= 3);
  assert.ok(lic.restrictions.length >= 3);
  assert.equal(lic.monetization, false);
  assert.ok(/저작권 성립 여부/.test(lic.ownershipStatement));
  assert.ok(issueLicense({ projectId: 'p1', tier: 'commercial' }).monetization);
});

test('provenance records human contribution and AI disclosure', () => {
  const prov = buildProvenance({
    projectId: 'p1',
    spec: pair.a,
    score: scoreA,
    runs: [],
    similarity: similarityCheck(scoreA),
    humanContributions: { lyricEditDistance: 12, lockedLines: 2, revisionCount: 1, variantSelected: 'A' },
    adapters: {},
  });
  assert.equal(prov.disclosure.aiGenerated, true);
  assert.ok(prov.humanContributions.lyricEditDistance > 0);
  assert.equal(prov.voice.clonesRealPerson, false);
  assert.ok(prov.generation.seed);
});

console.log('\n[capability registry]');
test('an unverified provider cannot take paid traffic', () => {
  const gate = readinessGate('provider-a');
  assert.equal(gate.ready, false);
  assert.ok(gate.blocking.includes('commercial_use_unverified'));
  assert.ok(gate.blocking.includes('no_contract_on_file'));
});

test('the active local engine passes the readiness gate', () => {
  assert.equal(readinessGate('local-synth').ready, true);
});

test('section revision falls back to full regeneration when unsupported', () => {
  const local = resolveExecutionPlan({ providerId: 'local-synth', scope: 'section', sectionCount: 10, changedSections: 3, durationSeconds: 190 });
  assert.equal(local.mode, 'section_patch');
  assert.equal(local.workUnits, 3);
  const remote = resolveExecutionPlan({ providerId: 'provider-a', scope: 'section', sectionCount: 10, changedSections: 3, durationSeconds: 190 });
  assert.equal(remote.mode, 'full_regenerate');
  assert.equal(remote.fallbackReason, 'provider_does_not_support_section_revision');
  assert.ok(remote.userMessage.ko.length > 5);
});

test('capability matrix exposes every provider', () => {
  assert.ok(capabilityMatrix().length >= 2);
});

console.log('\n[theory]');
test('progressions expand to one chord per bar', () => {
  const ch = chordsForSection('acoustic_ballad', 'chorus', 8, 4);
  assert.equal(ch.length, 8);
  assert.equal(ch[7].startBeat, 28);
});

test('snapToScale returns an in-key pitch', () => {
  const tonic = noteNameToMidi('C3');
  for (let m = 48; m < 72; m++) {
    const snapped = snapToScale(m, tonic, 'major');
    assert.ok(SCALES.major.includes(((snapped - tonic) % 12 + 12) % 12), m + ' -> ' + snapped);
  }
});

test('fitStructure respects tempo', () => {
  const slow = fitStructure(190, 64);
  const fast = fitStructure(190, 120);
  const bars = (p) => p.parts.reduce((a, x) => a + x.bars, 0);
  assert.ok(bars(fast) > bars(slow), 'faster tempo needs more bars for the same length');
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.error(f.name + ':\n' + (f.e.stack || f.e.message) + '\n');
  process.exit(1);
}
